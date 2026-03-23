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
const metaAccessToken = defineSecret("META_ACCESS_TOKEN");
const metaPixelId = defineSecret("META_PIXEL_ID");


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
        await queue.enqueue({ email: email }, { scheduleDelaySeconds: 3600 });
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
            to: email === "juandifsontet@gmail.com" ? [email] : [email, "juandifsontet@gmail.com"],
            reply_to: "juandifsontet@gmail.com",
            subject: "Ayer vi a un tipo gastando $22.000 en una app",
            html: `<div style="font-family: Georgia, serif; max-width: 520px; margin: auto; color: #222; font-size: 16px; line-height: 1.7;">
<p>Ayer en el subte vi a un tipo con cara de cansado pidiendo comida por una app.</p>

<p>$22.000. Una milanesa con papas fritas y una gaseosa.</p>

<p>Me quedé pensando.</p>

<p>Ese tipo va a hacer eso hoy también. Y mañana. Y el viernes cuando esté "demasiado cansado para cocinar".</p>

<p>Son como $90.000 al mes en comida que ni siquiera le gusta tanto.</p>

<p>Vos hace un rato entraste a ver el Sistema de Cenas en 15 Minutos.</p>

<p>Te interesaba. Algo te hizo click.</p>

<p>Pero no terminaste.</p>

<p>No sé si sonaste el teléfono, se te cortó internet o simplemente te distrajiste. Pasa.</p>

<p>Lo que sé es que esta noche, cuando sean las 20:30 y no tengas nada resuelto, vas a abrir Pedidos Ya.</p>

<p>Y vas a gastar en UNA cena lo que cuesta todo el sistema.</p>

<p>Tu acceso sigue acá, exactamente donde lo dejaste:</p>

<p><a href="https://leads-airfryer-7b2.web.app/index.html#seccion-checkout" style="color: #16a34a;">https://leads-airfryer-7b2.web.app/index.html#seccion-checkout</a></p>

<p>Son $5.900 por única vez.</p>

<p>Una cena de delivery cuesta más.</p>

<p>Vos sabés.</p>

<p style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">P.D. No te voy a mandar 47 correos insistiendo. Este es el primero y puede ser el último. Si querés seguir gastando $18.000 por noche en delivery tibio, es tu plata. Yo ya te avisé.</p>
</div>`
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
        to: email === "juandifsontet@gmail.com" ? [email] : [email, "juandifsontet@gmail.com"],
        reply_to: "juandifsontet@gmail.com",
        subject: "Te sigo debiendo una explicación",
        html: `<div style="font-family: Georgia, serif; max-width: 520px; margin: auto; color: #222; font-size: 16px; line-height: 1.7;">
<p>Mirá, voy a ser directo porque no tengo mucho tiempo y vos tampoco.</p>

<p>Ayer dejaste tu acceso al Sistema de Cenas en 15 min a medio terminar.</p>

<p>No sé si fue la tarjeta, si te arrepentiste, o si tu gato pisó el teclado.</p>

<p>Si fue lo segundo, perfecto.</p>

<p>Seguí lavando sartenes a las 22:00 con los ojos cerrados del sueño. Seguí pagando $18.000 por una hamburguesa aceitosa que llega fría.</p>

<p>No me cambia nada.</p>

<p>Pero si fue un error, o te distrajiste, o te faltó un segundo para decidirte...</p>

<p>Acá tenés el enlace: <a href="https://leads-airfryer-7b2.web.app/index.html#seccion-checkout" style="color: #16a34a;">terminar mi acceso</a></p>

<p>Son $5.900.</p>

<p>Lo que cuesta media docena de facturas en cualquier panadería.</p>

<p>La diferencia es que las facturas se terminan en 10 minutos.</p>

<p>Esto te resuelve la cena el resto del año.</p>

<p>Vos verás.</p>

<p style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">P.D. Este es el último correo que te mando sobre esto. No voy a rogarte. Si aparecés, te espero adentro. Si no, le deseo suerte a tu billetera con Rappi.</p>

<p>P.D. 2: Los que entraron ayer ya están cocinando cenas de 15 minutos sin ensuciar ni una sartén. Pero bueno, cada uno con sus prioridades.</p>
</div>`
    });
});

// ----------------------------------------------------
// 4. PROCESAMIENTO DE PAGO MERCADO PAGO 
// ----------------------------------------------------

exports.procesarPago = onRequest({ cors: true, secrets: [mpAccessToken] }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST permitido');
    const { token, transactionAmount, email, description, paymentMethodId, issuerId, installments, fbp, fbc } = req.body;
    if (!token || !transactionAmount || !email) return res.status(400).json({ error: "Faltan datos." });

    try {
        console.log(`[MP_QA] procesarPago - Recibido token: ${token}, monto: ${transactionAmount}, email: ${email}, fbp: ${fbp}`);
        
        // Guardar identificadores de Meta para el webhook
        await db.collection("leads_ebook_airfryer").doc(email).set({
            fbp: fbp || '',
            fbc: fbc || '',
            last_payment_attempt: admin.firestore.FieldValue.serverTimestamp(),
            last_interaction: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

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

exports.webhookMercadoPago = onRequest({ secrets: [mpWebhookSecret, mpAccessToken, metaAccessToken, metaPixelId, resendApiKey] }, async (req, res) => {
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
                    last_update: admin.firestore.FieldValue.serverTimestamp(),
                    last_interaction: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                
                console.log(`[MP_QA] Firestore actualizado con éxito para: ${mail}`);

                // --- ENVÍO DE EMAIL DE CONFIRMACIÓN (ESTILO ISRA BRAVO) ---
                try {
                    const { Resend } = require("resend");
                    const resend = new Resend(resendApiKey.value());
                    await resend.emails.send({
                        from: "Air Fryer Máster <onboarding@resend.dev>",
                        to: mail === "juandifsontet@gmail.com" ? [mail] : [mail, "juandifsontet@gmail.com"],
                        reply_to: "juandifsontet@gmail.com",
                        subject: "Lo que acaba de pasar",
                        html: `<div style="font-family: Georgia, serif; max-width: 520px; margin: auto; color: #222; font-size: 16px; line-height: 1.7;">
<p>Acabo de ver la notificación.</p>

<p>Alguien acaba de entrar al Sistema de Cenas en 15 Minutos.</p>

<p>Sos vos.</p>

<p>Y quiero que sepas algo que no le digo a todo el mundo:</p>

<p>La mayoría de la gente que vio esta página no compró. Se quedaron pensando "después vuelvo", "ahora no puedo", "a ver si me convence más".</p>

<p>Después son las 21:00, abren Pedidos Ya, y gastan $18.000 en una pizza que llega fría mientras miran el celular en el sillón.</p>

<p>Vos no. Vos decidiste otra cosa.</p>

<p>Y eso, créeme, dice más de vos que de cualquier receta.</p>

<p>Tu material ya está disponible. Podés descargarlo acá:</p>

<p><a href="https://leads-airfryer-7b2.web.app/gracias.html" style="color: #16a34a;">https://leads-airfryer-7b2.web.app/gracias.html</a></p>

<p>Guardá ese enlace. Es tuyo para siempre.</p>

<p>Esta semana te voy a mandar un par de cosas más que creo que te van a interesar. Nada de spam, nada de ofertas desesperadas. Solo cosas que yo usaría.</p>

<p>Bienvenido.</p>

<p style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">P.D. Si tenés alguna duda con la descarga, respondé a este correo. Leo todo.</p>

<p>P.D. 2: La primera cena que hagas con el sistema se paga sola. Literalmente cuesta menos que un delivery. Después contame qué tal.</p>
</div>`
                    });
                    console.log(`[MP_QA] Email de confirmación Isra Bravo enviado a ${mail}`);

                    // Programar correos de fidelización semanal
                    try {
                        const qFid1 = getFunctions().taskQueue("sendfidelizacion1");
                        const qFid2 = getFunctions().taskQueue("sendfidelizacion2");
                        await qFid1.enqueue({ email: mail }, { scheduleDelaySeconds: 604800 }); // 7 dias
                        await qFid2.enqueue({ email: mail }, { scheduleDelaySeconds: 1209600 }); // 14 dias
                        console.log(`[FIDELIZACIÓN] Correos semana 1 y 2 programados para ${mail}`);
                    } catch (fidError) {
                        console.error("[FIDELIZACIÓN_ERROR]", fidError);
                    }
                } catch (emailError) {
                    console.error("[MP_QA_ERROR] Fallo al enviar email de confirmación:", emailError);
                }

                // --- INTEGRACIÓN META CAPI ---
                try {
                    const leadDoc = await db.collection("leads_ebook_airfryer").doc(mail).get();
                    const leadData = leadDoc.data() || {};
                    
                    const hashedEmail = crypto.createHash('sha256').update(mail.toLowerCase().trim()).digest('hex');
                    let clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
                    if (clientIp.includes(',')) clientIp = clientIp.split(',')[0].trim();
                    const clientUA = leadData.client_ua || req.headers['user-agent'] || '';

                    const capiPayload = {
                        data: [
                            {
                                event_name: "Purchase",
                                event_time: Math.floor(Date.now() / 1000),
                                action_source: "website",
                                event_id: String(dataID),
                                user_data: {
                                    em: [hashedEmail],
                                    fbp: leadData.fbp ? [leadData.fbp] : [],
                                    fbc: leadData.fbc ? [leadData.fbc] : []
                                },
                                custom_data: {
                                    value: Number(paymentDetails.transaction_amount) || 5900,
                                    currency: "ARS",
                                    content_name: isUpsell ? "Pack Máster Air Fryer + Upsell" : "Sistema Cenas 15 Minutos"
                                }
                            }
                        ]
                    };

                    // Advanced Matching: First Name (fn)
                    if (leadData.nombre) {
                        const firstName = leadData.nombre.split(' ')[0].toLowerCase().trim();
                        const hashedFn = crypto.createHash('sha256').update(firstName).digest('hex');
                        capiPayload.data[0].user_data.fn = [hashedFn];
                    }

                    if (clientIp) capiPayload.data[0].user_data.client_ip_address = clientIp;
                    if (clientUA) capiPayload.data[0].user_data.client_user_agent = clientUA;

                    const phone = paymentDetails.payer.phone?.number;
                    if (phone) {
                        const cleanedPhone = String(phone).replace(/\D/g, '');
                        if (cleanedPhone) {
                            const hashedPhone = crypto.createHash('sha256').update(cleanedPhone).digest('hex');
                            capiPayload.data[0].user_data.ph = [hashedPhone];
                        }
                    }

                    const pixelId = metaPixelId.value().trim();
                    const token = metaAccessToken.value().trim();
                    
                    const metaResponse = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(capiPayload)
                    });

                    const metaResult = await metaResponse.json();
                    if (!metaResponse.ok) {
                        console.error("[META_CAPI_ERROR] Falla al enviar a Meta:", JSON.stringify(metaResult));
                    } else {
                        console.log(`[META_CAPI_SUCCESS] Evento Purchase enviado. ID: ${dataID}`);
                    }
                } catch (capiError) {
                    console.error("[META_CAPI_ERROR] Excepción CAPI:", capiError);
                }
                // --- FIN META CAPI ---
            }
        }
        res.status(200).send('OK');
    } catch (e) {
        console.error(`[MP_QA_ERROR] Excepción crítica en el Webhook:`, e);
        res.status(500).send('Error');
    }
});

// ----------------------------------------------------
// 6. CREACIÓN DE LINKS DE PAGO PARA UPSELL/DOWNSELL
// ----------------------------------------------------

exports.crearPreferencia = onRequest({ cors: true, secrets: [mpAccessToken] }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Solo POST permitido');
    
    // Parseo seguro del body, ya sea JSON explícito o string
    let bodyData = req.body;
    if (typeof bodyData === 'string') {
        try { bodyData = JSON.parse(bodyData); } catch(e) {}
    }

    const { title, price, email, successUrl } = bodyData;

    try {
        console.log(`[MP_PREF] Creando preferencia para ${email}: ${title} por $${price}`);
        const { Preference } = require('mercadopago');
        const client = new MercadoPagoConfig({ accessToken: mpAccessToken.value().trim() });
        const preference = new Preference(client);
        
        const response = await preference.create({
            body: {
                items: [
                    {
                        id: 'producto_extra',
                        title: title || 'Pack Saludable Air Fryer',
                        quantity: 1,
                        unit_price: Number(price)
                    }
                ],
                payer: { email: email },
                back_urls: {
                    success: successUrl || 'https://leads-airfryer-7b2.web.app/gracias.html',
                    failure: successUrl || 'https://leads-airfryer-7b2.web.app/gracias.html',
                    pending: successUrl || 'https://leads-airfryer-7b2.web.app/gracias.html'
                },
                auto_return: 'approved'
            }
        });
        
        console.log(`[MP_PREF] Preferencia creada. ID: ${response.id}`);
        
        // Devolvemos ambos puntos. El frontend decidirá cuál usar.
        res.status(200).json({ 
            init_point: response.init_point, 
            sandbox_init_point: response.sandbox_init_point,
            id: response.id
        });
    } catch (error) {
        console.error("[MP_PREF_ERROR] Error creando preferencia:", error);
        res.status(500).json({ error: "No se pudo generar el checkout", detail: error.message });
    }
});

// ----------------------------------------------------
// 7. FIDELIZACIÓN SEMANA 1: VIANDAS + CONGELA FÁCIL
// ----------------------------------------------------

exports.sendfidelizacion1 = onTaskDispatched(
    {
        retryConfig: { maxAttempts: 3 },
        secrets: [resendApiKey]
    },
    async (request) => {
    const { email } = request.data;
    const leadDoc = await db.collection("leads_ebook_airfryer").doc(email).get();
    if (!leadDoc.exists) return;

    const data = leadDoc.data();
    // Solo enviar si compró el producto principal y NO compró upsell
    if (!data.status?.includes('completado')) return;
    if (data.comprado_upsell) return;

    const { Resend } = require("resend");
    const resend = new Resend(resendApiKey.value());

    await resend.emails.send({
        from: "Air Fryer Máster <onboarding@resend.dev>",
        to: email === "juandifsontet@gmail.com" ? [email] : [email, "juandifsontet@gmail.com"],
        reply_to: "juandifsontet@gmail.com",
        subject: "El tupper más triste de la oficina",
        html: `<div style="font-family: Georgia, serif; max-width: 520px; margin: auto; color: #222; font-size: 16px; line-height: 1.7;">
<p>Hoy almorzamos en la oficina de un amigo.</p>

<p>Había un tipo en la mesa del fondo con un tupper de arroz blanco y un huevo duro.</p>

<p>Arroz blanco. Y un huevo duro.</p>

<p>Le puso sal, se sentó y lo comíó mirando el celular con cara de resignación.</p>

<p>Al lado había una mina con un tupper que parecía sacado de Instagram. Pollo especiado, ensalada de colores, papas al horno con romero.</p>

<p>Me acerqué y le pregunté: "Eso dónde lo pediste".</p>

<p>"Lo hice anoche en 20 minutos", me dijo. "Hago todo el domingo y congelo para la semana".</p>

<p>Ahí entendí algo:</p>

<p>El problema no es que "no tenés tiempo" para cocinar cosas ricas.

El problema es que nadie te enseñó a organizar las comidas para que NO te lleven tiempo.</p>

<p>Para eso hice dos guías que van juntas:</p>

<p><strong>"Viandas para el Trabajo"</strong> + <strong>"Planificá, Cociná y Congelá Fácil"</strong></p>

<p>Con las dos resolvés las comidas del laburo de toda la semana en una sola sesión de cocina el domingo.</p>

<p>Sin tupper triste. Sin gastar $4.000 por día en el kiosco de la esquina.</p>

<p>Vos ya tenés el sistema de cenas resuelto. Esto te cierra el círculo completo.</p>

<p>Si te interesa, es por acá: <a href="https://leads-airfryer-7b2.web.app/upsell.html" style="color: #16a34a;">ver el pack</a></p>

<p>Si no, no pasa nada. Seguí con el arroz.</p>

<p>Digo, con lo que tengas.</p>

<p style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">P.D. El tipo del huevo duro compró comida por $3.800 en el kiosco dos horas después porque tenía hambre. Cada uno elige cómo gastar su plata.</p>

<p>P.D. 2: Si ya compraste el pack completo, ignorá este correo y disfrutá tus viandas como un rey.</p>
</div>`
    });
    console.log(`[FIDELIZACIÓN] Correo semana 1 enviado a ${email}`);
});

// ----------------------------------------------------
// 8. FIDELIZACIÓN SEMANA 2: KETO + SNACKS
// ----------------------------------------------------

exports.sendfidelizacion2 = onTaskDispatched(
    {
        retryConfig: { maxAttempts: 3 },
        secrets: [resendApiKey]
    },
    async (request) => {
    const { email } = request.data;
    const leadDoc = await db.collection("leads_ebook_airfryer").doc(email).get();
    if (!leadDoc.exists) return;

    const data = leadDoc.data();
    if (!data.status?.includes('completado')) return;
    if (data.comprado_upsell) return;

    const { Resend } = require("resend");
    const resend = new Resend(resendApiKey.value());

    await resend.emails.send({
        from: "Air Fryer Máster <onboarding@resend.dev>",
        to: email === "juandifsontet@gmail.com" ? [email] : [email, "juandifsontet@gmail.com"],
        reply_to: "juandifsontet@gmail.com",
        subject: "El mito de la lechuga triste",
        html: `<div style="font-family: Georgia, serif; max-width: 520px; margin: auto; color: #222; font-size: 16px; line-height: 1.7;">
<p>Tengo una amiga que hizo dieta 14 veces en los últimos 3 años.</p>

<p>Catorce.</p>

<p>Las catorce empezaron igual: lechuga, pechuga hervida, agua con limón, cara de sufrimiento.</p>

<p>Las catorce terminaron igual: viernes a la noche, pizza con cuatro quesos, culpa, lunes de nuevo.</p>

<p>Un día le dije: "Flaca, el problema no es tu fuerza de voluntad. El problema es que comés como si estuvieras presa".</p>

<p>Se rió.</p>

<p>Después le pasé unas recetas keto que yo uso.</p>

<p>Pancakes de queso crema. Bombas de chocolate sin azúcar. Rolls de jamón y queso con palta. Cosas que parecían "prohibidas" pero estaban dentro del plan.</p>

<p>Hace 4 meses que come así. Bajó 8 kilos. Sin contar calorías. Sin pasar hambre. Sin cara de sufrimiento.</p>

<p>Todo lo que le pasé está en estas dos guías:</p>

<p><strong>"+500 Recetas Keto Completo"</strong> + <strong>"30 Snacks Listos"</strong></p>

<p>Son más de 500 recetas que no parecen "de dieta". Porque el secreto de la gente que come bien no es sufrir. Es comer cosas ricas que resultan ser saludables.</p>

<p>Si querés echarle un ojo: <a href="https://leads-airfryer-7b2.web.app/upsell.html" style="color: #16a34a;">ver las recetas</a></p>

<p>Si no, todo bien. Seguí comiendo lo que comés.</p>

<p>Total la que había bajado 8 kilos era mi amiga, no yo.</p>

<p>(bueno, yo también, pero eso es otra historia)</p>

<p style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">P.D. "Hacer dieta" es el mayor engaño del siglo. Lo que funciona es cambiar lo que comés sin sufrir. Eso lo inventaron los que cocinan bien, no los nutri que te dan una hoja con "150g de brócoli hervido".</p>

<p>P.D. 2: Los snacks keto son ideales para picar a las 17:00 cuando te pegó el bajoneazo del laburo. Mejor eso que un alfajor triple, que también está rico pero después te sentiste culpable 45 minutos.</p>

<p>P.D. 3: Este es el último correo de esta serie. A partir de acá solo te escribo si tengo algo genuinamente bueno. Palabra.</p>
</div>`
    });
    console.log(`[FIDELIZACIÓN] Correo semana 2 enviado a ${email}`);
});
