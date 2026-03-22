const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onTaskDispatched } = require("firebase-functions/v2/tasks");
const { getFunctions } = require("firebase-admin/functions");
const { defineSecret } = require("firebase-functions/params");
const { onRequest } = require("firebase-functions/v2/https");
const { MercadoPagoConfig, Payment } = require('mercadopago');
const crypto = require('crypto');
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();


// Secretos gestionados vía Firebase Secret Manager
const resendApiKey = defineSecret("RESEND_API_KEY");
const mpAccessToken = defineSecret("MP_ACCESS_TOKEN");
const mpWebhookSecret = defineSecret("MP_WEBHOOK_SECRET");


// ----------------------------------------------------
// 1. DISPARADOR DE LEADS: PROGRAMA AMBOS CORREOS
// ----------------------------------------------------

exports.onLeadCreated = onDocumentCreated("leads_ebook_airfryer/{userEmail}", async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const { email } = snapshot.data();
    console.log(`[TRIGGER] Nuevo lead: ${email}. Programando secuencia de recuperación...`);
    
    const queue = getFunctions().taskQueue("sendabandonedcartemail");
    const queue2 = getFunctions().taskQueue("sendabandonedcartemail2");

    try {
        // Tarea 1: En 1 hora
        await queue.enqueue({ email: email }, { scheduleDelaySeconds: 3600 });
        // Tarea 2: En 24 horas (86400 segundos)
        await queue2.enqueue({ email: email }, { scheduleDelaySeconds: 86400 });
        
        console.log(`[ÉXITO] Secuencia (1h y 24h) programada para ${email}.`);
    } catch (error) {
        console.error(`[ERROR] Fallo al programar tareas para ${email}:`, error);
    }
});

// ----------------------------------------------------
// 2. CORREO 1 (1 HORA DESPUÉS)
// ----------------------------------------------------

exports.sendabandonedcartemail = onTaskDispatched(
    {
        retryConfig: { maxAttempts: 3 },
        secrets: [resendApiKey]
    }, 
    async (request) => {
    const { email } = request.data;
    const leadDoc = await db.collection("leads_ebook_airfryer").doc(email).get();
    if (!leadDoc.exists) return;

    const data = leadDoc.data();
    if (data.status.includes('completado') || data.status === 'comprado') return;

    if (data.status === 'carrito_abandonado' || data.status === 'intentando_pago') {
        const { Resend } = require("resend");
        const resend = new Resend(resendApiKey.value());

        await resend.emails.send({
            from: "Air Fryer Máster <onboarding@resend.dev>",
            to: [email],
            subject: "¿Ya pediste delivery de nuevo? 🍔",
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: auto; color: #333;">
                    <p>Hola,</p>
                    <p>Sé lo que pasa: son las 19:30, llegaste cansado y lo último que querés es ensuciar la cocina.</p>
                    <p>Vas a terminar gastando $18.000 en una app de delivery. De nuevo.</p>
                    <p>Con el <strong>Sistema Cenas en 15 Minutos</strong> ($5.900), resolvés eso hoy mismo sin ensuciar nada. Se paga solo en la primera cena.</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="https://tudominio.com" style="background-color: #16a34a; color: white; padding: 15px 25px; text-decoration: none; font-weight: bold; border-radius: 5px;">👉 COMPLETAR MI PEDIDO AQUÍ</a>
                    </p>
                    <p>Te esperamos dentro,</p>
                    <p>El Equipo de Air Fryer Máster</p>
                </div>
            `
        });
    }
});

// ----------------------------------------------------
// 3. CORREO 2 (24 HORAS DESPUÉS)
// ----------------------------------------------------

exports.sendabandonedcartemail2 = onTaskDispatched(
    {
        retryConfig: { maxAttempts: 3 },
        secrets: [resendApiKey]
    }, 
    async (request) => {
    const { email } = request.data;
    const leadDoc = await db.collection("leads_ebook_airfryer").doc(email).get();
    if (!leadDoc.exists) return;

    const data = leadDoc.data();
    if (data.status.includes('completado') || data.status === 'comprado') return;

    const { Resend } = require("resend");
    const resend = new Resend(resendApiKey.value());

    await resend.emails.send({
        from: "Air Fryer Máster <onboarding@resend.dev>",
        to: [email],
        subject: "Mañana vas a volver a pedir pizza... (Leé esto antes) 🍕",
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; color: #333;">
                <p>Hola de nuevo,</p>
                <p>Solo paso por acá para recordarte que cada noche que "dudás" en llevarte el E-book, estás perdiendo unos $12.000 ARS en comida pesada de delivery.</p>
                <p>El <strong>Pack Máster Air Fryer</strong> cuesta solo $5.900 por única vez. Honestamente, es la inversión más inteligente que podés hacer para tu bolsillo y tu salud esta semana.</p>
                <p>Tu carrito sigue guardado, pero no por mucho tiempo más.</p>
                <p style="text-align: center; margin: 30px 0;">
                    <a href="https://tudominio.com" style="background-color: #16a34a; color: white; padding: 15px 25px; text-decoration: none; font-weight: bold; border-radius: 5px;">🔥 QUIERO MI PACK AHORA</a>
                </p>
                <p>Aprovechalo antes de que te olvides de nuevo,</p>
                <p>El Equipo de Air Fryer Máster</p>
            </div>
        `
    });
});

// ----------------------------------------------------
// 4. PROCESAMIENTO DE PAGO MERCADO PAGO 
// ----------------------------------------------------

exports.procesarPago = onRequest({ cors: true, secrets: [mpAccessToken] }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST permitido');
    const { token, transactionAmount, email, description, paymentMethodId, issuerId, installments } = req.body;
    if (!token || !transactionAmount || !email) return res.status(400).json({ error: "Faltan datos." });

    try {
        console.log(`[MP_QA] procesarPago - Recibido token: ${token}, monto: ${transactionAmount}, email: ${email}, method: ${paymentMethodId}, issuer: ${issuerId}`);
        const client = new MercadoPagoConfig({ accessToken: mpAccessToken.value().trim() });
        const payment = new Payment(client);

        // Construir body dinámicamente, omitiendo campos vacíos para evitar errores de API
        const paymentBody = {
            transaction_amount: Number(transactionAmount),
            token: token,
            description: description || 'Pack Máster Air Fryer',
            installments: Number(installments) || 1,
            payer: { email: email }
        };

        // Solo agregar si existen (la API falla con valores vacíos)
        if (paymentMethodId) paymentBody.payment_method_id = paymentMethodId;
        if (issuerId) paymentBody.issuer_id = String(issuerId);

        console.log(`[MP_QA] Enviando a MP API:`, JSON.stringify(paymentBody));
        const paymentData = await payment.create({ body: paymentBody });
        console.log(`[MP_QA] procesarPago EXITOSO - ID: ${paymentData.id}, Status: ${paymentData.status}, Detalle: ${paymentData.status_detail} para ${email}`);
        res.status(200).json({ status: paymentData.status, id: paymentData.id, status_detail: paymentData.status_detail });
    } catch (error) {
        console.error("[MP_QA_ERROR] Pago fallido:", error.message || error);
        if (error.cause) console.error("[MP_QA_ERROR] Causa:", JSON.stringify(error.cause));
        res.status(500).json({ error: "No se pudo procesar el pago.", detail: error.message || 'Unknown error' });
    }
});

// ----------------------------------------------------
// 5. WEBHOOK SEGURO CON FIRMA HMAC
// ----------------------------------------------------

exports.webhookMercadoPago = onRequest({ secrets: [mpWebhookSecret, mpAccessToken] }, async (req, res) => {
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    console.log(`[MP_QA] Webhook recibido - Request ID: ${xRequestId}`);
    if (!xSignature || !xRequestId) {
        console.error(`[MP_QA_ERROR] Faltan headers de seguridad`);
        return res.status(400).send('Bad Request');
    }

    try {
        const parts = xSignature.split(',');
        let ts, v1;
        parts.forEach(part => {
            const [k, v] = part.split('=');
            if (k === 'ts') ts = v;
            if (k === 'v1') v1 = v;
        });

        const dataID = req.body.data ? req.body.data.id : req.query['data.id'];
        const manifest = `id:${dataID};request-id:${xRequestId};ts:${ts};`;
        const hmac = crypto.createHmac('sha256', mpWebhookSecret.value().trim());
        hmac.update(manifest);
        
        if (hmac.digest('hex') !== v1) {
            console.error(`[MP_QA_ERROR] Firma inválida detectada para Request ID: ${xRequestId}`);
            return res.status(403).send('Invalid Signature');
        }

        console.log(`[MP_QA] Firma validada OK. Tipo de evento: ${req.body.type}, Data ID: ${dataID}`);

        if (req.body.type === 'payment') {
            const paymentDetails = await new Payment(new MercadoPagoConfig({ accessToken: mpAccessToken.value().trim() })).get({ id: dataID });
            
            console.log(`[MP_QA] Detalles del pago ID ${dataID} - Estado: ${paymentDetails.status}, Monto: ${paymentDetails.transaction_amount}`);

            if (paymentDetails.status === 'approved') {
                const mail = paymentDetails.payer.email;
                const desc = paymentDetails.description || '';
                const isUpsell = desc.toLowerCase().includes('mega') || desc.toLowerCase().includes('salud');
                
                console.log(`[MP_QA] Pago aprobado para: ${mail}. Es Upsell: ${isUpsell}`);

                await db.collection("leads_ebook_airfryer").doc(mail).set({
                    status: isUpsell ? 'pago_completado_upsell' : 'pago_completado_principal',
                    comprado_upsell: isUpsell,
                    last_update: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                console.log(`[MP_QA] Firestore actualizado con éxito para: ${mail}`);
            }
        }
        res.status(200).send('OK');
    } catch (e) {
        console.error(`[MP_QA_ERROR] Excepción crítica en el Webhook:`, e);
        res.status(500).send('Error');
    }
});
