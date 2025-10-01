const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs/promises');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const CloudConvert = require('cloudconvert'); // Nueva dependencia para la conversión

const app = express();
const port = process.env.PORT || 3000;

// =========================================================================
// --- CONFIGURACIÓN IMPORTANTE ---
// =========================================================================
const WORDPRESS_DOMAIN = 'https://cursos.ulalmexico.com';
const INSCRIPTION_API_URL = 'http://74.208.116.21/webApi/api/InscriptionsOnline/Create';
const DOCX_TEMPLATE_PATH = path.resolve(__dirname, 'contrato_template.docx');

// --- Configuración de CloudConvert ---
// ¡DEBES RELLENAR ESTO CON TU API KEY DE CLOUDCONVERT!
CLOUDCONVERT_API_KEY='eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiMGJkZTc0MzQ0MTU0MzM0ZmEzZWFjNWM3YWVjNDQ1NmU4NjU2YmE4MjZjMWZiMmNhNzEzMWI2MGFjNjliYTI3MGNhOTc5ZTAxM2ViYWY0NjkiLCJpYXQiOjE3NTkxODI1MDIuNjA3MjEsIm5iZiI6MTc1OTE4MjUwMi42MDcyMTEsImV4cCI6NDkxNDg1NjEwMi42MDM4MTcsInN1YiI6IjczMDQ5MDAwIiwic2NvcGVzIjpbInVzZXIucmVhZCIsInVzZXIud3JpdGUiLCJ0YXNrLnJlYWQiLCJ0YXNrLndyaXRlIiwid2ViaG9vay5yZWFkIiwicHJlc2V0LnJlYWQiLCJ3ZWJob29rLndyaXRlIiwicHJlc2V0LndyaXRlIl19.dzbH_V1HRcztu9dpuLyUUYIttX6eMmIZJvRn15LBm3qOBSQa4AHqfrJNFAMfvZXrl2PV7H8zZGl3eFXVq0KwWWzIYuIJtrFqbg6PMMDoduan4mvt4Mb__9rju_N1BXpn6NebbKLppUjIlco0yxXsmva-p_iYosTvooYmIShI4W7BCKCNxuXzlM3glJ11xGLKfV2dEQapjprD6yJNr20Ci-Igc3Sp0VJw7oHpag5qse7SK8_ObeWFimSFfBoQOQPxAhF9Z4bMT1dvSRWrTKCniOfaTlzqGSchKDD2wxEq7VQYjUpEpDgqktXjhxtVtVgsDuymUqMi84XhSFmF7_f2yb2rmt-vmj2ueW7GbM0v8GV_fZvjil4vZ9WwEJ9isfpsNZ1WeAZRZqKYR1vQYuOKM-icvRILRS9FJHISWCDMafcDz3TsATtQhDL_1NLyVTTFoeJMA8BhUQh7DVldac0u2_y6QYySu9EuPKpgujCP-SzSr9v_SzBRNRfl9JmE95EthLt9zkN-qcCIFJD6O8Ke5fQeHBb863VepuWHFe9Rqm_XFqdPLttjV54l-fT5bPGKLnUefMMv60T05glhBgJ_RA-rmgOlAkrrUFY41ADNoL3M6XYdaGXI8zFv9ibnT85jKRVOf66YDUS5B2cBiOgniWmHR3nFFsbnqMMV4UU115I';
const cloudConvert = new CloudConvert(CLOUDCONVERT_API_KEY);

// --- Configuración de Cloudinary (ACTUALIZADA) ---
cloudinary.config({ 
  cloud_name: 'dsvopdjag', 
  api_key: '466177364661179', 
  api_secret: 'day8VRwm764EhnakK5Gn0J5zvYE' 
});

// --- Configuración de Evolution API (WhatsApp) ---
const EVOLUTION_API_URL = 'https://wasap-evolution-api.hdwudh.easypanel.host';
const EVOLUTION_INSTANCE_NAME = 'ulal-agenda';
const EVOLUTION_API_KEY = 'B4EC9047E4F6-41CE-B777-EEA592F360BC';
// =========================================================================

app.use(cors({ origin: WORDPRESS_DOMAIN }));
app.use(express.json());

// --- Función para formatear fechas ---
const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// --- FUNCIÓN ACTUALIZADA: Solo genera el buffer del DOCX ---
async function createDocxBuffer(data) {
    const now = new Date();
    const termDate = new Date();
    termDate.setMonth(now.getMonth() + 4);
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    
    const placeholders = {
        '1': data.socialNetwork || 'N/A', '3': data.firstName, '4': data.lastName,
        '5': data.lastNameMother, '6': formatDate(data.dateBirth), '7': data.age.toString(),
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
    
    try {
        doc.render(placeholders);
    } catch (error) {
        throw new Error(`Error de Docxtemplater: ${error.message}. Revisa tus placeholders @X@.`);
    }

    return doc.getZip().generate({ type: 'nodebuffer' });
}

// --- NUEVA FUNCIÓN: Convierte el DOCX a PDF usando la API de CloudConvert ---
async function convertDocxToPdfViaApi(docxBuffer) {
    console.log('Iniciando trabajo de conversión en CloudConvert...');
    let job = await cloudConvert.jobs.create({
        tasks: {
            'import-docx': {
                operation: 'import/upload'
            },
            'convert-to-pdf': {
                operation: 'convert',
                input: 'import-docx',
                output_format: 'pdf',
                engine: 'libreoffice',
            },
            'export-pdf': {
                operation: 'export/url',
                input: 'convert-to-pdf',
                inline: false,
            }
        }
    });

    const uploadTask = job.tasks.find(task => task.name === 'import-docx');
    await cloudConvert.tasks.upload(uploadTask, docxBuffer, 'contrato.docx');
    
    job = await cloudConvert.jobs.wait(job.id);
    
    const exportTask = job.tasks.find(task => task.name === 'export-pdf' && task.status === 'finished');
    if (!exportTask || !exportTask.result.files) {
        throw new Error('La exportación del PDF desde CloudConvert falló.');
    }
    
    const pdfUrl = exportTask.result.files[0].url;
    console.log('PDF convertido y disponible en:', pdfUrl);
    return pdfUrl;
}

// --- Función para subir el PDF a Cloudinary ---
async function uploadPdfToCloudinary(pdfUrl, fileName) {
     const uploadResult = await cloudinary.uploader.upload(pdfUrl, {
        resource_type: 'raw', // 'raw' es mejor para PDFs en Cloudinary
        public_id: fileName,
        folder: 'contratos',
    });
    return uploadResult;
}

// --- Función para enviar PDF por WhatsApp (usando URL) ---
async function sendWhatsAppPdfWithUrl(number, pdfUrl, fileName) {
    const url = `${EVOLUTION_API_URL}/message/sendMedia/${EVOLUTION_INSTANCE_NAME}`;
    const jid = `521${number}@s.whatsapp.net`;

    const payload = {
        number: jid,
        options: { delay: 1200 },
        mediatype: 'document',
        media: pdfUrl,
        fileName: fileName
    };

    try {
        console.log(`Enviando URL de PDF a ${jid}: ${pdfUrl}`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
            body: JSON.stringify(payload),
            timeout: 30000 
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(` -> Error al enviar URL de PDF a ${jid}. Código: ${response.status}. Respuesta: ${errorText}`);
        } else {
            console.log(` -> URL de PDF a ${jid} encolada para envío.`);
        }
    } catch (e) {
        console.error(` -> Fallo crítico al enviar URL de PDF a ${jid}. Error: ${e.toString()}`);
    }
}

// --- Función para enviar texto por WhatsApp ---
async function sendWhatsAppMessage(number, message) {
    const url = `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE_NAME}`;
    const jid = `521${number}@s.whatsapp.net`;
    const payload = { 
        number: jid, 
        options: { delay: 1200 }, 
        text: message 
    };
    
    try {
        console.log(`Enviando texto a ${jid}...`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
            body: JSON.stringify(payload),
            timeout: 10000
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(` -> Error al enviar texto a ${jid}. Código: ${response.status}. Respuesta: ${errorText}`);
        } else {
            console.log(` -> Texto a ${jid} encolado para envío.`);
        }
    } catch (e) {
        console.error(` -> Fallo crítico al enviar texto a ${jid}. Error: ${e.toString()}`);
    }
}

// --- Ruta Principal del Proxy ---
app.post('/api/inscribe', async (req, res) => {
    console.log('Petición recibida:', req.body);
    const incomingData = req.body;
    try {
        // Tarea 1: Enviar inscripción al sistema interno
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

        // Tarea 2: Generar el buffer del DOCX rellenado
        console.log('Generando contrato desde plantilla DOCX...');
        const docxBuffer = await createDocxBuffer(incomingData);
        
        // Tarea 3: Convertir el DOCX a PDF usando la API de CloudConvert
        const tempPdfUrl = await convertDocxToPdfViaApi(docxBuffer);

        // Tarea 4: Subir el PDF desde la URL temporal a Cloudinary
        console.log('Subiendo PDF a Cloudinary...');
        const fileName = `Contrato-ULAL-${incomingData.firstName}-${Date.now()}.pdf`;
        const uploadResult = await uploadPdfToCloudinary(tempPdfUrl, fileName);
        const cloudinaryUrl = uploadResult.secure_url;
        console.log(`PDF subido con éxito a: ${cloudinaryUrl}`);

        // Tarea 5: Enviar por WhatsApp
        const whatsappMessage = `¡Hola ${incomingData.firstName}! Gracias por inscribirte. Adjunto encontrarás una copia de tu solicitud de inscripción.`;
        await sendWhatsAppMessage(incomingData.phone, whatsappMessage);
        await sendWhatsAppPdfWithUrl(incomingData.phone, cloudinaryUrl, fileName);

        res.status(200).json({ message: 'Inscripción procesada. Se ha enviado una copia del contrato a tu WhatsApp.' });
    } catch (error) {
        console.error('Error en el proxy:', error.message);
        res.status(500).json({ error: 'Hubo un error al procesar la solicitud.', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor proxy escuchando en el puerto ${port}`);
});

