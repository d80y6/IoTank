
import { supabase } from '../src/config/supabase';

async function checkSchema() {
    console.log('Checking shift_closures schema...');
    const { data, error } = await supabase.rpc('get_table_info', { t_name: 'shift_closures' });
    if (error) {
        console.error('Error fetching table info:', error);
        // Fallback: try to select one row to see columns
        const { data: row, error: rowErr } = await supabase.from('shift_closures').select('*').limit(1);
        if (rowErr) console.error('Error selecting row:', rowErr);
        else console.log('Columns:', Object.keys(row[0]));
    } else {
        console.log('Table Info:', data);
    }
}

checkSchema();
