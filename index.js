// =========================================================================
// --- SERVIDOR DE FIRMA ELECTRÓNICA ULAL ---
// =========================================================================

// --- Dependencias ---
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import streamifier from 'streamifier';
import cron from 'node-cron';

// Librerías de documentos
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import CloudConvert from 'cloudconvert';
import { v2 as cloudinary } from 'cloudinary'; 
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// --- FIX: Crear __dirname para módulos ES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Inicialización del Servidor ---
const WORDPRESS_DOMAIN = process.env.WORDPRESS_DOMAIN;
const TEMP_PDF_PATH = path.resolve(__dirname, 'temp_pdfs');
const FINAL_PDF_PATH = path.resolve(__dirname, 'final_pdfs');
const app = express();
const port = process.env.PORT || 3000;
(async () => {
    await fs.mkdir(TEMP_PDF_PATH, { recursive: true });
    await fs.mkdir(FINAL_PDF_PATH, { recursive: true });
})();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(cors({ origin: WORDPRESS_DOMAIN }));

// =========================================================================
// --- CONFIGURACIÓN GENERAL ---
// =========================================================================
const CRON_SECRET = process.env.CRON_SECRET

const INSCRIPTION_API_URL = process.env.INSCRIPTION_API_URL;
const DOCX_TEMPLATE_PATH = path.resolve(__dirname, 'resources' , 'contrato_template.docx');
const AUTOMATIC_SIGNATURE_PATH = path.resolve(__dirname, 'resources' , 'firma_ulal.png'); 

const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY; 
const cloudConvert = new CloudConvert(CLOUDCONVERT_API_KEY);

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

// --- Configuración de Evolution API (WhatsApp) ---
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// --- Rutas de Almacenamiento ---


// --- Ubicaciones para las Firmas y Fechas en cada página ---
const USER_SIGNATURE_WIDTH = 203;
const USER_SIGNATURE_HEIGHT = 60;
const USER_SIGNATURE_LOCATIONS = [
    { page: 0, sigX: 110, sigY: 80, dateX: 110, dateY: 60 },
    { page: 1, sigX: 110, sigY: 70, dateX: 110, dateY: 50 },
    { page: 2, sigX: 110, sigY: 100, dateX: 110, dateY: 80 },
    { page: 3, sigX: 110, sigY: 90,  dateX: 110, dateY: 80 },
    { page: 4, sigX: 110, sigY: 165, dateX: 110, dateY: 130 },
    { page: 5, sigX: 130, sigY: 110, dateX: 130, dateY: 90 },
    { page: 6, sigX: 110, sigY: 140, dateX: 110, dateY: 90 },
    { page: 7, sigX: 120, sigY: 115, dateX: 110, dateY: 90 }
];

// --- NUEVO: Coordenadas de la Firma Automática ---
const AUTOMATIC_SIGNATURE_WIDTH = 203; // Puedes ajustar el tamaño si es diferente
const AUTOMATIC_SIGNATURE_HEIGHT = 60;
const AUTOMATIC_SIGNATURE_LOCATIONS = [
    { page: 0, sigX: 340, sigY: 80, textX: 340, textY: 60 },
    { page: 1, sigX: 340, sigY: 70, textX: 340, textY: 50 },
    { page: 2, sigX: 340, sigY: 100, textX: 340, textY: 80 },
    { page: 3, sigX: 340, sigY: 90, textX: 340, textY: 80 },
    { page: 4, sigX: 340, sigY: 165, textX: 340, textY: 130 },
    { page: 5, sigX: 360, sigY: 110, textX: 360, textY: 90 },
    { page: 6, sigX: 340, sigY: 140, textX: 340, textY: 90 },
    { page: 7, sigX: 350, sigY: 115, textX: 340, textY: 90 }
];
// =========================================================================


// --- Funciones Auxiliares ---

const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};

const sendWhatsAppMessage = async (number, message) => {
    if (!number) {
        console.error("No se proporcionó número para enviar WhatsApp.");
        return;
    }
    const jid = `521${number}@s.whatsapp.net`;
    try {
        await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE_NAME}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
            body: JSON.stringify({ number: jid, options: { delay: 1200 }, text: message })
        });
    } catch (e) {
        console.error(`Fallo al enviar WhatsApp a ${jid}: ${e.toString()}`);
    }
};

const sendWhatsAppPdfWithUrl = async (number, pdfUrl, fileName) => {
    if (!number) {
        console.error("No se proporcionó número para enviar el PDF por WhatsApp.");
        return;
    }
    const jid = `521${number}@s.whatsapp.net`;
    try {
        await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${EVOLUTION_INSTANCE_NAME}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
            body: JSON.stringify({ number: jid, options: { delay: 1200 }, mediatype: 'document', media: pdfUrl, fileName: fileName })
        });
    } catch (e) {
        console.error(`Fallo al enviar PDF por WhatsApp a ${jid}: ${e.toString()}`);
    }
};

async function clearDirectory(directoryPath) {
    try {
        const files = await fs.readdir(directoryPath);
        if (files.length === 0) {
            console.log(`[Cron Cleanup] Directorio ya está vacío: ${directoryPath}`);
            return { deleted_count: 0, directory: path.basename(directoryPath) };
        }
        const unlinkPromises = files.map(file => fs.unlink(path.join(directoryPath, file)));
        await Promise.all(unlinkPromises);
        console.log(`[Cron Cleanup] Se eliminaron ${files.length} archivos de: ${directoryPath}`);
        return { deleted_count: files.length, directory: path.basename(directoryPath) };
    } catch (err) {
        if (err.code !== 'ENOENT') { // ENOENT = Directorio no encontrado (lo cual está bien)
            console.error(`[Cron Cleanup] Error al limpiar el directorio ${directoryPath}:`, err);
        }
        return { deleted_count: 0, directory: path.basename(directoryPath) };
    }
}

// --- Funciones de Procesamiento de Documentos ---

const createDocxBuffer = async (data) => {
    const now = new Date();
    const termDate = new Date();
    termDate.setMonth(now.getMonth() + 4);
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    
    const placeholders = {
        '1': data.socialNetwork || 'N/A', '3': data.firstName, '4': data.lastName,
        '5': data.lastNameMother, '6': formatDate(data.dateBirth), '7': data.age ? data.age.toString() : '',
        '8': data.placeBirth, '9': data.levelEducation, '10': data.lastSchool,
        '11': data.curp, '12': data.phone, '13': data.phoneFamily,
        '14': data.phoneOther, '15': data.email,
        '19': formatDate(now.toISOString().split('T')[0]),
        '21': formatDate(now.toISOString().split('T')[0]),
        '22': meses[termDate.getMonth()]
    };

    const content = await fs.readFile(DOCX_TEMPLATE_PATH);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { delimiters: { start: '@', end: '@' }, paragraphLoop: true, linebreaks: true });
    doc.render(placeholders);
    return doc.getZip().generate({ type: 'nodebuffer' });
};

async function convertDocxToPdfViaApi(docxBuffer) {
    console.log('Iniciando conversión a PDF en CloudConvert...');
    let job = await cloudConvert.jobs.create({
        tasks: { 'import-docx': { operation: 'import/upload' }, 'convert-to-pdf': { operation: 'convert', input: 'import-docx', output_format: 'pdf' }, 'export-pdf': { operation: 'export/url', input: 'convert-to-pdf' } }
    });
    const uploadTask = job.tasks.find(task => task.name === 'import-docx');
    await cloudConvert.tasks.upload(uploadTask, docxBuffer, 'contrato.docx');
    job = await cloudConvert.jobs.wait(job.id);
    const exportTask = job.tasks.find(task => task.name === 'export-pdf' && task.status === 'finished');
    if (!exportTask || !exportTask.result.files) {
        throw new Error('La exportación del PDF desde CloudConvert falló.');
    }
    return exportTask.result.files[0].url;
}

async function uploadPdfToCloudinary(pdfBuffer, fileName) {
    console.log('Subiendo PDF a Cloudinary desde buffer...');
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({ resource_type: 'raw', public_id: fileName, folder: 'contratos' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        streamifier.createReadStream(pdfBuffer).pipe(uploadStream);
    });
}

// =========================================================================
// --- RUTAS DE LA APLICACIÓN ---
// =========================================================================

app.post('/api/inscribe', async (req, res) => {
    console.log('Petición de inscripción recibida...');
    const incomingData = req.body;
    try {
        fetch(INSCRIPTION_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessUnitId: "1", itemServiceId: "897",
                firstName: incomingData.firstName, lastName: incomingData.lastName,
                lastNameMother: incomingData.lastNameMother, curp: incomingData.curp,
                dateBirth: incomingData.dateBirth, age: incomingData.age,
                placeBirth: incomingData.placeBirth, levelEducation: incomingData.levelEducation,
                lastSchool: incomingData.lastSchool, phone: incomingData.phone,
                phoneFamily: incomingData.phoneFamily, phoneOther: incomingData.phoneOther,
                email: incomingData.email
            })
        }).then(response => {
            if (!response.ok) console.error(`Error en API de inscripción: ${response.statusText}`);
            else console.log('Inscripción enviada al sistema interno.');
        }).catch(err => console.error('Error al enviar a API de inscripción:', err));
        // Tarea 1: Rellenar plantilla DOCX
        const docxBuffer = await createDocxBuffer(incomingData);

        // Tarea 2: Convertir a PDF usando CloudConvert
        const tempPdfUrl = await convertDocxToPdfViaApi(docxBuffer);
        
        // Tarea 3: Descargar el PDF convertido para guardarlo temporalmente
        const pdfResponse = await fetch(tempPdfUrl);
        if (!pdfResponse.ok) throw new Error(`Error al descargar el PDF de CloudConvert: ${pdfResponse.statusText}`);
        const pdfBuffer = await pdfResponse.buffer();

        // Tarea 4: Guardar PDF temporal y datos del usuario
        const docId = uuidv4();
        await fs.writeFile(path.join(TEMP_PDF_PATH, `${docId}.pdf`), pdfBuffer);
        const userInfo = { phone: incomingData.phone, name: incomingData.firstName };
        await fs.writeFile(path.join(TEMP_PDF_PATH, `${docId}.json`), JSON.stringify(userInfo));
        
        // Tarea 5: Generar y enviar enlace de firma
        // IMPORTANTE: Cambia 'localhost:3000' por tu dominio o IP pública para que el enlace funcione fuera de tu servidor.
        const signingUrl = `https://contracts-ulal.vercel.app/sign/${docId}`; 
        const signingMessage = `¡Hola ${incomingData.firstName}!👋 Bienvenido a Universidad En Línea América Latina🧑‍🎓 \nPor favor, firma tu contrato de inscripción en el siguiente enlace:👇👇\n\n${signingUrl}`;
        await sendWhatsAppMessage(incomingData.phone, signingMessage);

        console.log(`Proceso iniciado. Enlace de firma generado: ${signingUrl}`);
        res.status(200).json({ message: 'Enlace de firma generado y enviado correctamente.' });

    } catch (error) {
        console.error('Error en /api/inscribe:', error);
        res.status(500).json({ error: 'Hubo un error al procesar la solicitud.', details: error.message });
    }
});
app.get('/sign/:id', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public' , 'signing.html'));
});
app.get('/pdf/:id', async (req, res) => {
    const docId = req.params.id;
    const filePath = path.join(TEMP_PDF_PATH, `${docId}.pdf`);
    try {
        await fs.access(filePath);
        res.sendFile(filePath);
    } catch {
        res.status(404).send('Documento no encontrado o ya ha sido firmado.');
    }
});
app.post('/api/finalize-signature', async (req, res) => {
    const { docId, signatureImage } = req.body;
    console.log(`Finalizando firma para el documento: ${docId}`);
    try {
        // --- Cargar todos los recursos ---
        const unsignedPdfPath = path.join(TEMP_PDF_PATH, `${docId}.pdf`);
        const userInfoPath = path.join(TEMP_PDF_PATH, `${docId}.json`);
        const pdfBuffer = await fs.readFile(unsignedPdfPath);
        const userInfo = JSON.parse(await fs.readFile(userInfoPath, 'utf8'));
        // Firma del usuario (dibujada)
        const userSignatureBuffer = Buffer.from(signatureImage.split('base64,')[1], 'base64');
        
        // Firma automática (desde archivo)
        const automaticSignatureBuffer = await fs.readFile(AUTOMATIC_SIGNATURE_PATH);
        
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();

        // Incrustar ambas imágenes de firma en el documento
        const userSignatureEmbed = await pdfDoc.embedPng(userSignatureBuffer);
        const automaticSignatureEmbed = await pdfDoc.embedPng(automaticSignatureBuffer);

        // --- Estampar Firma del Usuario y Fecha ---
        const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
        for (const loc of USER_SIGNATURE_LOCATIONS) {
            if (loc.page < pages.length) {
                const page = pages[loc.page];
                page.drawImage(userSignatureEmbed, {
                    x: loc.sigX, y: loc.sigY,
                    width: USER_SIGNATURE_WIDTH, height: USER_SIGNATURE_HEIGHT,
                });
                page.drawText(`Firmado el: ${today}`, {
                    x: loc.dateX, y: loc.dateY,
                    font: helveticaFont, size: 8, color: rgb(0.1, 0.1, 0.1),
                });
            }
        }
        
        // --- NUEVO: Estampar Firma Automática y Leyenda ---
        const legend = "Inscripción Automática en Plataforma";
        for (const loc of AUTOMATIC_SIGNATURE_LOCATIONS) {
            if (loc.page < pages.length) {
                const page = pages[loc.page];
                page.drawImage(automaticSignatureEmbed, {
                    x: loc.sigX, y: loc.sigY,
                    width: AUTOMATIC_SIGNATURE_WIDTH, height: AUTOMATIC_SIGNATURE_HEIGHT,
                });
                page.drawText(legend, {
                    x: loc.textX, y: loc.textY,
                    font: helveticaFont, size: 8, color: rgb(0.1, 0.1, 0.1),
                });
            }
        }

        // --- Guardar y finalizar ---
        const finalFileName = `contrato-firmado-${userInfo.name.replace(/\s+/g, '-')}-${docId.substring(0, 8)}.pdf`;
        const finalPdfBytes = await pdfDoc.save();
        const finalPdfPath = path.join(FINAL_PDF_PATH, `contrato-firmado-${docId}.pdf`);
        await fs.writeFile(finalPdfPath, finalPdfBytes);
        await fs.unlink(unsignedPdfPath);
        // Subir a Cloudinary
        const uploadResult = await uploadPdfToCloudinary(finalPdfBytes, finalFileName);
        console.log(`PDF firmado subido a Cloudinary: ${uploadResult.secure_url}`);

        // Enviar copia final por WhatsApp
        await sendWhatsAppMessage(userInfo.phone, `¡Gracias ${userInfo.name}!🤗 Tu contrato ha sido firmado. Te adjuntamos una copia.📝👇`);
        await sendWhatsAppPdfWithUrl(userInfo.phone, uploadResult.secure_url, finalFileName);
        
        res.status(200).json({ message: '¡Documento firmado con éxito! Se ha enviado una copia por WhatsApp.' });
        console.log(`Documento ${docId} firmado con ambas firmas y guardado.`);
        res.status(200).json({ message: '¡Documento firmado con éxito!' });

    } catch (error) {
        console.error('Error en /api/finalize-signature:', error);
        res.status(500).json({ error: 'No se pudo procesar y guardar la firma.' });
    }
});
app.get('/api/cron/clear-folders', async (req, res) => {
    // 1. Proteger la ruta
    if (req.headers['authorization'] !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ message: 'No autorizado' });
    }

    console.log('[Vercel Cron] Ejecutando tarea de limpieza diaria de directorios locales...');
    
    try {
        const results = await Promise.all([
            clearDirectory(TEMP_PDF_PATH),
            clearDirectory(FINAL_PDF_PATH)
        ]);

        console.log('[Vercel Cron] Tarea de limpieza finalizada.');
        res.status(200).json({ success: true, results });

    } catch (error) {
        console.error('[Vercel Cron] Error en la tarea de limpieza:', error);
        res.status(500).json({ success: false, message: 'Error durante la limpieza.' });
    }
});
// --- Iniciar Servidor ---
app.listen(port, () => {
    console.log(`Servidor de firma escuchando en http://localhost:${port}`);
});