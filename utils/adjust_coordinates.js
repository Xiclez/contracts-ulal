// adjust_server.js
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();
const port = 4000; // Usamos un puerto diferente para no chocar con tu app principal

// --- Archivos de Prueba ---
const SOURCE_PDF = './contrato_template(1).pdf';
const OUTPUT_PDF = './test_output_signed.pdf';

app.use(express.static(__dirname)); // Servir archivos estáticos como adjust_page.html
app.use(express.json({ limit: '10mb' })); // Para recibir la firma en base64

// Ruta principal que sirve la página de ajuste
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'adjust_page.html'));
});

// Ruta que recibe los datos, procesa el PDF y lo guarda
app.post('/apply-signature', async (req, res) => {
    const { signatureImage, locations, signatureSize } = req.body;

    try {
        console.log('Recibida petición de ajuste. Procesando PDF...');
        const pdfBuffer = await fs.readFile(SOURCE_PDF);
        const signatureImageBuffer = Buffer.from(signatureImage.split('base64,')[1], 'base64');
        
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const signatureImageEmbed = await pdfDoc.embedPng(signatureImageBuffer);
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();
        const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

        for (const loc of locations) {
            if (loc.page < pages.length) {
                const page = pages[loc.page];
                
                // Estampar la firma dibujada
                page.drawImage(signatureImageEmbed, {
                    x: loc.sigX,
                    y: loc.sigY,
                    width: signatureSize.width,
                    height: signatureSize.height,
                });

                // Estampar la fecha
                page.drawText(`Firmado el: ${today}`, {
                    x: loc.dateX,
                    y: loc.dateY,
                    font: helveticaFont,
                    size: 8,
                    color: rgb(0.1, 0.1, 0.1),
                });
            }
        }

        const finalPdfBytes = await pdfDoc.save();
        await fs.writeFile(OUTPUT_PDF, finalPdfBytes);
        
        console.log(`-> "${OUTPUT_PDF}" generado con éxito.`);
        res.status(200).json({ message: `"${OUTPUT_PDF}" generado con éxito. ¡Revísalo!` });

    } catch (error) {
        console.error('Error al generar el PDF de prueba:', error);
        res.status(500).json({ message: `Error: ${error.message}` });
    }
});

app.listen(port, () => {
    console.log(`\n✅ Servidor de ajuste iniciado.`);
    console.log(`   Abre http://localhost:${port} en tu navegador.`);
});