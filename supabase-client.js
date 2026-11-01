const SUPABASE_JS_MODULE = "https://esm.sh/@supabase/supabase-js@2";

export function isSupabaseConfigured() {
  const config = window.HOSTAL_SUPABASE_CONFIG;
  return Boolean(config?.url?.startsWith("https://") && config.anonKey);
}

export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Configura la URL y la clave pública de Supabase en supabase-config.js.");
  }

  const { createClient } = await import(SUPABASE_JS_MODULE);
  const { url, anonKey } = window.HOSTAL_SUPABASE_CONFIG;
  return createClient(url, anonKey);
}
