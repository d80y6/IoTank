import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.40.0"

serve(async (req) => {
    try {
        const body = await req.json();
        const { Body: { stkCallback } } = body;

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') || '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
        );

        const checkoutRequestId = stkCallback.CheckoutRequestID;
        const resultCode = stkCallback.ResultCode;

        if (resultCode === 0) {
            // SUCCESS: Extract metadata
            const metadata = stkCallback.CallbackMetadata.Item;
            const amount = metadata.find((i: any) => i.Name === 'Amount').Value;
            const receipt = metadata.find((i: any) => i.Name === 'MpesaReceiptNumber').Value;
            
            // Find the pending transaction
            const { data: tx } = await supabase
                .from('billing_transactions')
                .select('station_id, id')
                .eq('provider_ref', checkoutRequestId)
                .single();

            if (tx) {
                // Finalize payment in ledger via RPC
                await supabase.rpc('process_payment', {
                    p_station_id: tx.station_id,
                    p_amount: amount,
                    p_payment_method: 'MPESA',
                    p_payment_reference: receipt,
                    p_description: `M-Pesa STK Push Confirmation (${receipt})`
                });

                // Update transaction status
                await supabase.from('billing_transactions')
                    .update({ status: 'COMPLETED' })
                    .eq('id', tx.id);
            }
        } else {
            // FAILURE: Update transaction status
            await supabase.from('billing_transactions')
                .update({ status: 'FAILED' })
                .eq('provider_ref', checkoutRequestId);
        }

        return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }), { status: 200 });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }
})
