# Hostal La Estancia

Sitio público y panel de administración para editar textos, datos de contacto y fotos. El contenido y los usuarios se guardan en Supabase.

## Configuración inicial de Supabase

1. Crea un proyecto en Supabase y conserva su URL y la clave **anon/public**. En `supabase-config.js`, completa:

   ```js
   window.HOSTAL_SUPABASE_CONFIG = {
     url: "https://TU-PROYECTO.supabase.co",
     anonKey: "TU_CLAVE_ANON_PUBLICA",
   };
   ```

   Esta clave pública se usa en el navegador; nunca pongas aquí una `service_role` key.

2. Aplica `supabase/migrations/20261101000000_site_content_and_roles.sql` al proyecto. Puedes usar Supabase CLI (`supabase link` y `supabase db push`) o ejecutar el archivo desde el SQL Editor de Supabase.

3. En Authentication, desactiva el registro público. Crea tu cuenta inicial desde el panel de Supabase Auth y confirma el correo. El trigger crea su perfil con rol `pending`. En SQL Editor, busca su UUID en `auth.users` y promuévelo una sola vez:

   ```sql
   update public.user_profiles
   set role = 'admin'
   where user_id = 'UUID-DE-TU-USUARIO';
   ```

   La acción de crear administradores no está expuesta en el panel del sitio. Solo un administrador podrá invitar responsables desde **Administración → Usuarios**.

4. Configura la URL pública del sitio en Authentication → URL Configuration. Añade `https://TU-DOMINIO/admin.html` a las URLs de redirección permitidas. Configura SMTP para que Supabase pueda entregar las invitaciones.

5. Despliega la función de invitación y configura su origen permitido:

   ```powershell
   supabase functions deploy invite-owner
   supabase secrets set APP_URL=https://TU-DOMINIO ALLOWED_ORIGINS=https://TU-DOMINIO
   ```

   `APP_URL` debe ser el origen HTTPS exacto del sitio, sin ruta ni barra final. Si publicas en varios dominios, incluye cada origen exacto en `ALLOWED_ORIGINS`, separado por comas. La función usa además los secretos `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del entorno de Supabase; la clave `service_role` nunca debe copiarse al navegador.

6. Publica los archivos del proyecto en un hosting estático con HTTPS. No se requiere compilación. Para probar localmente, desde la carpeta del proyecto ejecuta `python -m http.server 8000` y abre `http://localhost:8000`; las invitaciones reales requieren un dominio HTTPS y ese dominio debe aparecer en `APP_URL` y `ALLOWED_ORIGINS`.

## Uso del panel

- Abre `/admin.html` e inicia sesión como administrador o responsable.
- El responsable puede modificar textos, contacto y fotos; el administrador también puede invitar responsables.
- La invitación lleva a `/admin.html`, donde la persona invitada crea una contraseña de al menos 12 caracteres. Configura en Supabase una política de contraseña compatible con ese requisito.
- Las fotos aceptadas son JPG, PNG y WebP, con un máximo de 5 MB cada una. Se publican en el bucket `hostal-media`.
- Los cambios se reflejan en el sitio público después de guardarlos.

No uses la clave `service_role` en archivos estáticos ni habilites registros públicos: ambas decisiones podrían permitir acceso no autorizado.
