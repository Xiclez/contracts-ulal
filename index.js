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
    sendWhatsAppPdfWithUrl
} from './utils/functions.js';

// --- Creación de __dirname para módulos ES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: WORDPRESS_DOMAIN }));
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

// --- Exportar la app para Vercel ---
export default app;

// En Vercel, el `app.listen` no es necesario, pero lo dejamos para desarrollo local.
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`Servidor de desarrollo escuchando en http://localhost:${port}`));
}