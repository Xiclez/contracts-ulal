// utils/functions.js

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import streamifier from 'streamifier';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import CloudConvert from 'cloudconvert';
import { v2 as cloudinary } from 'cloudinary';

// --- Creación de __dirname para módulos ES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =========================================================================
// --- CONFIGURACIÓN (Toda la configuración vive aquí) ---
// =========================================================================
export const WORDPRESS_DOMAIN = process.env.WORDPRESS_DOMAIN || 'https://cursos.ulalmexico.com';
export const INSCRIPTION_API_URL = process.env.INSCRIPTION_API_URL || 'http://74.208.116.21/webApi/api/InscriptionsOnline/Create';

// Rutas a los recursos (ajustadas para salir de la carpeta 'utils')
export const DOCX_TEMPLATE_PATH = path.resolve(__dirname, '..', 'resources', 'contrato_template.docx');
export const AUTOMATIC_SIGNATURE_PATH = path.resolve(__dirname, '..', 'resources', 'firma_ulal.png');

// Claves de APIs
const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
export const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
export const EVOLUTION_INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME;
export const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
export const CRON_SECRET = process.env.CRON_SECRET;

// Inicialización de servicios
export const cloudConvert = new CloudConvert(CLOUDCONVERT_API_KEY);
cloudinary.config({ 
  cloud_name: CLOUDINARY_CLOUD_NAME, 
  api_key: CLOUDINARY_API_KEY, 
  api_secret: CLOUDINARY_API_SECRET 
});

// Coordenadas de Firmas
export const USER_SIGNATURE_WIDTH = 203;
export const USER_SIGNATURE_HEIGHT = 60;
export const USER_SIGNATURE_LOCATIONS = [
    { page: 0, sigX: 110, sigY: 80, dateX: 110, dateY: 60 },
    { page: 1, sigX: 110, sigY: 70, dateX: 110, dateY: 50 },
    { page: 2, sigX: 110, sigY: 100, dateX: 110, dateY: 80 },
    { page: 3, sigX: 110, sigY: 90,  dateX: 110, dateY: 80 },
    { page: 4, sigX: 110, sigY: 165, dateX: 110, dateY: 130 },
    { page: 5, sigX: 130, sigY: 110, dateX: 130, dateY: 90 },
    { page: 6, sigX: 110, sigY: 140, dateX: 110, dateY: 90 },
    { page: 7, sigX: 120, sigY: 115, dateX: 110, dateY: 90 }
];
export const AUTOMATIC_SIGNATURE_WIDTH = 203;
export const AUTOMATIC_SIGNATURE_HEIGHT = 60;
export const AUTOMATIC_SIGNATURE_LOCATIONS = [
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


// =========================================================================
// --- FUNCIONES (Exportadas para ser usadas en index.js) ---
// =========================================================================

export const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};

export const sendWhatsAppMessage = async (number, message) => {
    if (!number || !EVOLUTION_API_URL) return;
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

export const sendWhatsAppPdfWithUrl = async (number, pdfUrl, fileName) => {
    if (!number || !EVOLUTION_API_URL) return;
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

export const createDocxBuffer = (data) => {
    const content = fs.readFileSync(DOCX_TEMPLATE_PATH);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { delimiters: { start: '@', end: '@' } });
    const now = new Date();
    const termDate = new Date();
    termDate.setMonth(now.getMonth() + 4);
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const placeholders = {
        '1': data.socialNetwork || 'N/A', '3': data.firstName, '4': data.lastName, '5': data.lastNameMother,
        '6': formatDate(data.dateBirth), '7': data.age ? data.age.toString() : '', '8': data.placeBirth,
        '9': data.levelEducation, '10': data.lastSchool, '11': data.curp, '12': data.phone,
        '13': data.phoneFamily, '14': data.phoneOther, '15': data.email,
        '19': formatDate(now.toISOString().split('T')[0]), '21': formatDate(now.toISOString().split('T')[0]),
        '22': meses[termDate.getMonth()]
    };
    doc.render(placeholders);
    return doc.getZip().generate({ type: 'nodebuffer' });
};

export async function convertDocxToPdfViaApi(docxBuffer) {
    let job = await cloudConvert.jobs.create({
        tasks: { 
            'import-docx': { operation: 'import/upload' }, 
            'convert-to-pdf': { operation: 'convert', input: 'import-docx', output_format: 'pdf' }, 
            'export-pdf': { operation: 'export/url', input: 'convert-to-pdf' } 
        }
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

export async function uploadPdfToCloudinary(pdfBuffer, publicId) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({ resource_type: 'raw', public_id: publicId, folder: 'contratos' }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        streamifier.createReadStream(pdfBuffer).pipe(uploadStream);
    });
}