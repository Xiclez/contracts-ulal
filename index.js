// index.js

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { v2 as cloudinary } from 'cloudinary';
import ftp from 'basic-ftp';
import mongoose from 'mongoose';
import 'dotenv/config';

// --- Importamos TODAS las funciones y configuraciones desde nuestro archivo de utilidades ---
import {
    WORDPRESS_DOMAIN,
    CRON_SECRET,
    INSCRIPTION_API_URL,
    AUTOMATIC_SIGNATURE_PATH,
    USER_SIGNATURE_LOCATIONS,
    USER_SIGNATURE_WIDTH,
    USER_SIGNATURE_HEIGHT,
    AUTOMATIC_SIGNATURE_LOCATIONS,
    AUTOMATIC_SIGNATURE_WIDTH,
    AUTOMATIC_SIGNATURE_HEIGHT,
    createDocxBuffer,
    convertDocxToPdfViaApi,
    uploadPdfToCloudinary,
    sendWhatsAppMessage,
    sendWhatsAppPdfWithUrl,
    ftpConfig,
    basePublicUrl,
    ftpBasePath,
    imageDirs,
    videoDir,
    getDimensionsFromFilename,
    shuffleArray,
    Registro,
    transporter
} from './utils/functions.js';

// --- CONEXIÓN A MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// --- Creación de __dirname para módulos ES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// =========================================================================
// --- RUTAS DE LA APLICACIÓN ---
// =========================================================================

// --- RUTA DEL CRON JOB PARA LIMPIAR CLOUDINARY ---
app.get('/api/cron', async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }
  console.log('Ejecutando tarea cron de limpieza de Cloudinary...');
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { resources } = await cloudinary.api.resources({
      type: 'upload', resource_type: 'raw', prefix: 'contratos/unsigned-', max_results: 100
    });
    const oldFiles = resources.filter(file => file.created_at < twentyFourHoursAgo);
    if (oldFiles.length === 0) {
      return res.status(200).json({ message: 'No hay archivos temporales antiguos que limpiar.' });
    }
    const publicIdsToDelete = oldFiles.map(file => file.public_id);
    await cloudinary.api.delete_resources(publicIdsToDelete, { resource_type: 'raw' });
    console.log(`Limpieza completada. Se eliminaron ${publicIdsToDelete.length} archivos.`);
    res.status(200).json({ success: true, deleted_count: publicIdsToDelete.length });
  } catch (error) {
    console.error('Error durante la ejecución del cron job:', error);
    res.status(500).json({ success: false, message: 'Error en la tarea de limpieza.' });
  }
});

// --- RUTA DE INSCRIPCIÓN ---
app.post('/api/inscribe', async (req, res) => {
    const incomingData = req.body;
    try {
        // Enviar a sistema interno en segundo plano
        fetch(INSCRIPTION_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(incomingData)
        }).catch(err => console.error('Error enviando a API de inscripción:', err));
        
        const docxBuffer = createDocxBuffer(incomingData);
        const tempPdfUrl = await convertDocxToPdfViaApi(docxBuffer);
        const pdfResponse = await fetch(tempPdfUrl);
        const pdfBuffer = await pdfResponse.buffer();

        const docId = `unsigned-${uuidv4()}`;
        await uploadPdfToCloudinary(pdfBuffer, docId);
        
        const queryParams = new URLSearchParams({
            phone: incomingData.phone,
            name: incomingData.firstName
        }).toString();
        
        // Generar URL dinámicamente para Vercel
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const signingUrl = `${protocol}://${host}/sign/${docId}?${queryParams}`;

        await sendWhatsAppMessage(incomingData.phone, `¡Hola ${incomingData.firstName}! Bienvenido a Universidad En Línea América Latina! 🧑‍🎓📚 \nPor favor, firma tu contrato de inscripción aquí:👇👇\n${signingUrl}`);
        res.status(200).json({ message: 'Enlace de firma generado y enviado.' });
    } catch (error) {
        console.error('Error en /api/inscribe:', error);
        res.status(500).json({ error: 'Hubo un error al procesar la solicitud.', details: error.message });
    }
});

// --- RUTA PARA MOSTRAR PÁGINA DE FIRMA ---
app.get('/sign/:id', (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/html');
        const htmlContent = fs.readFileSync(path.resolve(__dirname, 'public', 'signing.html'), 'utf8');
        res.send(htmlContent);
    } catch (error) {
        res.status(500).send("Error al cargar la página de firma.");
    }
});

// --- RUTA PARA FINALIZAR FIRMA ---
app.post('/api/finalize-signature', async (req, res) => {
    const { docId, signatureImage, phone, name } = req.body;
    try {
        const unsignedPdfUrl = cloudinary.url(`contratos/${docId}`, { resource_type: 'raw' });
        const pdfResponse = await fetch(unsignedPdfUrl);
        const pdfBuffer = await pdfResponse.buffer();
        
        const automaticSignatureBuffer = fs.readFileSync(AUTOMATIC_SIGNATURE_PATH);
        const userSignatureBuffer = Buffer.from(signatureImage.split('base64,')[1], 'base64');

        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const userSignatureEmbed = await pdfDoc.embedPng(userSignatureBuffer);
        const automaticSignatureEmbed = await pdfDoc.embedPng(automaticSignatureBuffer);
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();
        const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

        // Estampar firma del usuario
        for (const loc of USER_SIGNATURE_LOCATIONS) {
            if (loc.page < pages.length) {
                pages[loc.page].drawImage(userSignatureEmbed, {
                    x: loc.sigX, y: loc.sigY,
                    width: USER_SIGNATURE_WIDTH, height: USER_SIGNATURE_HEIGHT,
                });
                pages[loc.page].drawText(`Firmado el: ${today}`, { 
                    x: loc.dateX, y: loc.dateY,
                    font: helveticaFont, size: 8, color: rgb(0.1, 0.1, 0.1)
                });
            }
        }
        
        // Estampar firma automática
        for (const loc of AUTOMATIC_SIGNATURE_LOCATIONS) {
            if (loc.page < pages.length) {
                pages[loc.page].drawImage(automaticSignatureEmbed, {
                    x: loc.sigX, y: loc.sigY,
                    width: AUTOMATIC_SIGNATURE_WIDTH, height: AUTOMATIC_SIGNATURE_HEIGHT,
                });
                pages[loc.page].drawText("Inscripción Automática en Plataforma", { 
                    x: loc.textX, y: loc.textY,
                    font: helveticaFont, size: 8, color: rgb(0.1, 0.1, 0.1)
                });
            }
        }

        const finalPdfBytes = await pdfDoc.save();
        const finalFileName = `contrato-firmado-${name.replace(/\s+/g, '-')}-${Date.now()}.pdf`;
        const uploadResult = await uploadPdfToCloudinary(finalPdfBytes, finalFileName);
        
        await cloudinary.uploader.destroy(`contratos/${docId}`, { resource_type: 'raw' });

        await sendWhatsAppMessage(phone, `¡Gracias ${name}! Tu contrato ha sido firmado.🤗 \nTe adjuntamos una copia.👇📝`);
        await sendWhatsAppPdfWithUrl(phone, uploadResult.secure_url, finalFileName);
        
        res.status(200).json({ message: '¡Documento firmado con éxito!' });
    } catch (error) {
        console.error('Error en /api/finalize-signature:', error);
        res.status(500).json({ error: 'No se pudo procesar la firma.' });
    }
});

app.get('/get-media', async (req, res) => {
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
        console.log("Conectando al servidor FTP...");
        await client.access(ftpConfig);
        console.log("Conexión FTP exitosa.");

        // --- PROCESAR IMÁGENES ---
        console.log("Obteniendo lista de imágenes...");
        const allImageFullPaths = [];
        for (const dir of imageDirs) {
            console.log(`- Escaneando: ${dir}`);
            const filesInDir = await client.list(dir);
            for (const file of filesInDir) {
                // Se construye la ruta completa manualmente para asegurar que es correcta
                allImageFullPaths.push(`${dir}/${file.name}`);
            }
        }
        
        console.log("Procesando imágenes para encontrar las de mayor resolución...");
        const groupedImages = {};
        for (const fullPath of allImageFullPaths) {
            const filename = fullPath.substring(fullPath.lastIndexOf('/') + 1);
            const dimensions = getDimensionsFromFilename(filename);

            if (dimensions) {
                const baseName = filename.replace(/-(\d+)[xX](\d+)\.[a-zA-Z]{3,4}$/, '');
                const area = dimensions.width * dimensions.height;

                if (!groupedImages[baseName] || area > groupedImages[baseName].area) {
                    // Se crea la URL pública a partir de la ruta completa
                    const relativePath = fullPath.replace(ftpBasePath, '');
                    groupedImages[baseName] = {
                        url: `${basePublicUrl}${relativePath}`,
                        area: area
                    };
                }
            }
        }
        const finalImageList = Object.values(groupedImages).map(group => group.url);
        console.log(`Encontradas ${finalImageList.length} imágenes únicas de máxima resolución.`);

        // --- PROCESAR VIDEOS ---
        console.log("Obteniendo lista de videos...");
        const videoFiles = await client.list(videoDir);
        const finalVideoList = videoFiles
            .filter(file => file.name.toLowerCase().endsWith('.mp4'))
            .map(file => {
                // Se construye la ruta completa manualmente para asegurar que es correcta
                const fullPath = `${videoDir}/${file.name}`;
                const relativePath = fullPath.replace(ftpBasePath, '');
                return `${basePublicUrl}${relativePath}`;
            });
        console.log(`Encontrados ${finalVideoList.length} videos.`);

        // --- SELECCIÓN ALEATORIA Y RESPUESTA FINAL ---
        shuffleArray(finalImageList);
        shuffleArray(finalVideoList);

        const selectedImages = finalImageList.slice(0, 15);
        const selectedVideos = finalVideoList.slice(0, 15);

        let finalMedia = [...selectedImages, ...selectedVideos];
        shuffleArray(finalMedia);

        console.log(`Enviando ${finalMedia.length} medios al cliente. ✨`);
        res.json(finalMedia);

    } catch (err) {
        console.error("Error en la operación FTP:", err);
        res.status(500).json({ error: "No se pudo conectar o procesar los archivos del servidor FTP." });
    } finally {
        if (!client.closed) {
            console.log("Cerrando conexión FTP.");
            client.close();
        }
    }
});
// --- ENDPOINT DE REGISTRO ---
app.post('/api/registro', async (req, res) => {
    try {
        // 1. Obtenemos y validamos los datos del payload
        const { nombre, apellido, whatsApp, email, nivel } = req.body;

        if (!nombre || !apellido || !whatsApp || !email || !nivel) {
            return res.status(400).json({ message: 'Faltan campos obligatorios en el payload.' });
        }

        const mensajeBienvenida = `¡Hola, ${nombre}! 👋 Gracias por registrarte. Tu nivel es: ${nivel}. Te invitamos a mirar nuestra guía completa de uso de la plataforma aqui: 👇👇👇 \n https://youtu.be/o17Ja8WUFXA`;
        

        sendWhatsAppMessage(whatsApp, mensajeBienvenida);
        if (nivel.toLowerCase() === 'licenciatura' || nivel.toLowerCase() === 'ingeniería') {
            const pdfUrl2 = process.env.PDF_BIENVENIDA_URL2;
            await sendWhatsAppPdfWithUrl(whatsApp, pdfUrl2, 'Bienvenida ULAL.pdf');
        }else if (nivel.toLowerCase() === 'preparatoria') {
            const pdfUrl = process.env.PDF_BIENVENIDA_URL; 
        sendWhatsAppPdfWithUrl(whatsApp, pdfUrl, 'Documento de Bienvenida.pdf');
        }
        // 2. Creamos el registro en MongoDB
        const nuevoRegistro = new Registro({ nombre, apellido, whatsApp, email, nivel });
        await nuevoRegistro.save();
        console.log(`💾 Registro guardado para: ${email}`);

        
        // 4. Enviamos el correo electrónico de confirmación
        const mailOptions = {
    from: `"Cursos ULAL México" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '✅ ¡Registro exitoso!',
    html: `
        <h1>¡Bienvenido, ${nombre} ${apellido}!</h1>
        <p>Tu registro en nuestra plataforma ha sido completado exitosamente.</p>
        <p>Estos son los datos que registraste:</p>
        <ul>
            <li><strong>Nombre:</strong> ${nombre} ${apellido}</li>
            <li><strong>WhatsApp:</strong> ${whatsApp}</li>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>Nivel:</strong> ${nivel}</li>
        </ul>
        <p>Adjuntamos un documento con información importante para que comiences.</p>
        <p>¡Gracias por unirte!</p>
    `,
    // --- SECCIÓN AÑADIDA PARA EL ARCHIVO ADJUNTO ---
    attachments: [
        {
            filename: 'Documento de Bienvenida.pdf', // El nombre que verá el usuario
            path: process.env.PDF_BIENVENIDA_URL,     // La URL pública del PDF
            contentType: 'application/pdf'           // El tipo de archivo (opcional, pero recomendado)
        }
    ]
};

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(`❌ Error al enviar email a ${email}:`, error);
            } else {
                console.log(`💌 Email enviado exitosamente a ${email}: ${info.response}`);
            }
        });
        
        // --- Respuesta exitosa ---
        res.status(201).json({ 
            message: 'Registro creado exitosamente. Se han enviado las notificaciones.',
            data: nuevoRegistro 
        });

    } catch (error) {
        // Manejo de errores (ej. email duplicado)
        if (error.code === 11000) {
            return res.status(409).json({ message: 'El correo electrónico ya está registrado.' });
        }
        console.error('🔥 Error en el endpoint /registro:', error);
        res.status(500).json({ message: 'Ocurrió un error en el servidor.' });
    }
});
// --- Exportar la app para Vercel ---
export default app;

// En Vercel, el `app.listen` no es necesario, pero lo dejamos para desarrollo local.
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`Servidor de desarrollo escuchando en http://localhost:${port}`));
}