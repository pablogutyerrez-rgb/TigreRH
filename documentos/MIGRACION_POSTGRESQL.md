# Migracion completa a PostgreSQL

## Punto de recuperacion

- Rama: `recovery/pre-full-postgres-20260911`
- Commit desplegado previo: `d0a6340`
- Checkpoint de la migracion parcial: `3f99d9a`
- Firestore no se elimina ni modifica durante el corte.

## Inventario de persistencia

Colecciones declaradas o usadas por el codigo:

| Firestore | Uso | Destino PostgreSQL |
| --- | --- | --- |
| `users` | Perfiles | `tigre_rh.users` y `tigre_rh.current_documents` |
| `user_credentials` | Credenciales locales | `tigre_rh.user_credentials` y `tigre_rh.current_documents` |
| `sessions` | Capacitaciones | `tigre_rh.sessions`, `tigre_rh.session_trainers` y `tigre_rh.current_documents` |
| `participants` | Participantes | `tigre_rh.participants` y `tigre_rh.current_documents` |
| `attendance` | Asistencias | `tigre_rh.attendance` y `tigre_rh.current_documents` |
| `campaigns` | Campanas | `tigre_rh.current_documents` |
| `confirmations` | Confirmaciones | `tigre_rh.current_documents` |
| `reopens` | Reaperturas | `tigre_rh.current_documents` |
| `logs` | Auditoria | `tigre_rh.current_documents` |
| `surveys` | Encuestas | `tigre_rh.current_documents` |
| `responses` | Respuestas | `tigre_rh.current_documents` |
| `file_records` | Metadatos de archivos | `tigre_rh.current_documents` |
| `training_closures` | Cierres | `tigre_rh.current_documents` |
| `app_settings` | Configuracion | `tigre_rh.current_documents` |
| `selection_requisitions` | Requisiciones | `tigre_rh.current_documents` |
| `selection_applicants` | Postulantes | `tigre_rh.current_documents` |
| `selection_audit` | Auditoria de seleccion | `tigre_rh.current_documents` |
| `selection_notifications` | Notificaciones | `tigre_rh.current_documents` |
| `selection_requisition_code_counters` | Contadores de codigo | `tigre_rh.current_documents` |
| `selection_requisition_codes` | Reservas de codigo | `tigre_rh.current_documents` |
| `prospects` | Prospectos | `tigre_rh.current_documents` |
| `evaluacion_variable_formacion` | Evaluacion variable | `tigre_rh.current_documents` |
| `evaluacion_variable_formacion_historial` | Historial de evaluacion | `tigre_rh.current_documents` |
| `correos_enviados` o `EMAIL_TRACE_COLLECTION` | Trazas de correo | `tigre_rh.current_documents` |
| `cv_records` | Metadatos de CV | `tigre_rh.current_documents` |

El codigo de la aplicacion no declara subcolecciones. El migrador enumera las colecciones raiz reales, por lo que tambien incorpora cualquier coleccion raiz no documentada que exista en el proyecto.

## Mapeo de documentos

`tigre_rh.current_documents` conserva:

- `collection_name` y `document_id` como clave primaria compuesta.
- `document_path` para la ruta Firestore original.
- `payload` como JSONB utilizable por la aplicacion.
- `source_payload` como representacion sin perdida de tipos Firestore.
- `source_create_time`, `source_update_time` y `source_hash`.
- `is_deleted` para bajas logicas posteriores al corte.

El codec etiqueta timestamps, fechas, referencias, geopuntos, bytes, numeros no finitos y valores `undefined`. Arrays, objetos anidados y `null` se conservan recursivamente.

## Ejecucion controlada

Desde `backend`:

```powershell
npm run migrate:firestore:postgres
npm run migrate:firestore:postgres -- --apply
npm run validate:postgres:migration
npm run test:postgres:persistence
```

El primer comando solo enumera colecciones. `--apply` procesa paginas de 250 documentos, guarda el cursor y los contadores en `tigre_rh.firestore_migration_state`, y puede reanudarse ejecutando exactamente el mismo comando. Una coleccion completada no se relee. Una falla detiene el proceso y no activa ningun fallback.

No se debe volver a ejecutar `activate:postgres-cutover` despues de que la aplicacion empiece a recibir cambios en PostgreSQL. Ese script se conserva solo para reconstruir el checkpoint inicial en un rollback controlado.

## Railway

Variables requeridas:

- `DATABASE_URL`: cadena PostgreSQL vigente, sin reemplazarla si ya funciona.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`: Firebase Admin Auth y acceso temporal a Storage.
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`: Firebase Auth del navegador y bucket temporal.
- Las variables funcionales existentes de correo, Google Drive, CORS y URL publica se mantienen.

Ya no se requieren para persistencia `FIREBASE_DATABASE_URL` ni `POSTGRES_COMPLETE_COLLECTIONS`. No deben borrarse de Railway hasta verificar el despliegue; simplemente quedan sin uso.

## Rollback temporal

1. Conservar Firestore sin escrituras ni borrados.
2. Volver a desplegar el commit `d0a6340` o la rama `recovery/pre-full-postgres-20260911`.
3. No borrar las tablas PostgreSQL; sirven para analizar o reintentar el corte.
4. No mezclar escrituras de ambas versiones durante el rollback.
