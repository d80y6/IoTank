import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    try {
        const { phone, amount, reference, stationId } = await req.json();

        // 1. Fetch Credentials from Environment
        const CONSUMER_KEY = Deno.env.get('MPESA_CONSUMER_KEY');
        const CONSUMER_SECRET = Deno.env.get('MPESA_CONSUMER_SECRET');
        const PASSKEY = Deno.env.get('MPESA_PASSKEY');
        const SHORTCODE = Deno.env.get('MPESA_SHORTCODE');
        const CALLBACK_URL = Deno.env.get('MPESA_CALLBACK_URL'); // e.g. https://xyz.supabase.co/functions/v1/mpesa-callback

        if (!CONSUMER_KEY || !CONSUMER_SECRET || !PASSKEY || !SHORTCODE) {
            throw new Error('M-Pesa credentials not configured in Supabase secrets');
        }

        // 2. Generate OAuth Token
        const auth = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
        const tokenRes = await fetch("https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
            headers: { Authorization: `Basic ${auth}` }
        });
        const { access_token } = await tokenRes.json();

        // 3. Generate Password
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
        const password = btoa(SHORTCODE + PASSKEY + timestamp);

        // 4. Initiate STK Push
        const res = await fetch("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                BusinessShortCode: SHORTCODE,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: Math.round(amount),
                PartyA: phone.replace('+', ''),
                PartyB: SHORTCODE,
                PhoneNumber: phone.replace('+', ''),
                CallBackURL: CALLBACK_URL,
                AccountReference: reference,
                TransactionDesc: `Payment for IoTank Station ${stationId}`
            })
        });

        const data = await res.json();
        return new Response(JSON.stringify(data), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
        });
    }
})
