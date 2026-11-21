# desguaproterm

Terminal propia para trabajar con Claude Code. Núcleo en Rust (Tauri 2 + ConPTY) e interfaz en WebView2 con xterm.js. Todo cabe en un solo `desguaproterm.exe`.

## Qué hace

- **Pestañas con tema.** Cada pestaña dice de qué va la sesión en 2-3 palabras. Claude genera un título de la conversación y Haiku lo resume una vez por título; se puede desactivar en Ajustes. Debajo aparece el proyecto. Doble clic en una pestaña para ponerle nombre a mano.
- **Resumen (izquierda).** Las sesiones agrupadas por estado: **Te necesitan** (permiso o pregunta), **Trabajando**, **Acabadas**, **En espera** y **Cerradas**. Cada sesión muestra sus subagentes y qué están haciendo. Arriba están los **tokens de hoy** de todo el PC, por tipo y por modelo.
- **Agentes (derecha de cada sesión).** Panel que se puede minimizar (`Ctrl+Shift+A`). Muestra el estado del Claude principal, su contexto y sus tokens, y cada subagente con su tipo, tarea, acción actual, tiempo, modelo y gasto.
- **Gasto.** Tokens y **precio por API** (tarifas oficiales en `src-tauri/src/pricing.rs`) de cada **tarea**, es decir, de cada mensaje que le mandas a Claude más sus subagentes, de cada sesión y del día. Al lado va el **% de la semana**, ponderado por precio. La pestaña **Gasto** filtra por hoy/semana y proyecto, busca y ordena por precio, tokens o fecha. Arriba del resumen está el **% real de tus límites** (5 h y semanal), que Claude Code pasa a la barra de estado. La semana es la ventana de 7 días de tu plan.
- **Avisos de Windows.** Cuando una sesión que no miras termina, falla o te pide permiso. En los permisos traen **Aprobar / Rechazar** (también en el resumen y en el panel de agentes): la app responde al diálogo de Claude con Enter (Sí) o Esc (No). También avisa al llegar a un % del límite del plan y, si lo activas, de las tareas que pasen de cierto precio.
- **Líneas tocadas.** +añadidas / −quitadas y archivos de cada tarea y sesión, sacadas del parche exacto que guarda Claude en cada edición.
- **Sesiones aisladas.** El botón ⎇ abre otra sesión en un worktree de git (`claude --worktree`, en `.claude/worktrees/<nombre>` del proyecto). Así varias sesiones del mismo proyecto no se pisan.
- **Buscador de conversaciones.** En Proyectos, a partir de 3 letras, busca en todo lo que hablaste con Claude. Al pulsar un resultado se reabre esa conversación.
- **Imágenes y archivos.** `Ctrl+V` con una imagen se la pega a Claude (le manda su atajo, `Alt+V`). Al soltar archivos sobre una sesión se le pasan sus rutas, y las imágenes se adjuntan. Al soltar una carpeta fuera de las sesiones se abre como proyecto. Al pasar el ratón por `[Image #N]` se ve la imagen.
- **Gráfica de gasto por día** (14 días) en la pestaña Gasto.
- **Lanzador de proyectos.** Lista los proyectos donde ya usaste Claude, con favoritos y búsqueda.
- **Varias sesiones a la vez**, en pestañas o en cuadrícula (`Ctrl+Shift+G`).
- **Restauración.** Al reabrir vuelven las mismas pestañas, cada una con su conversación, también tras `/clear` o `/resume`.
- **8 temas** en Ajustes (`Ctrl+,`):

  | Tema | Estilo |
  |---|---|
  | Brasa | Oscuro cálido |
  | Hacker | Fósforo verde y barrido |
  | Retro | Ámbar CRT |
  | Colorido | Morado vibrante |
  | Neón 84 | Synthwave |
  | Desguace | Industrial, franjas de peligro |
  | Abisal | Fondo marino |
  | Papel | Claro |

## Cómo sabe lo que hace cada Claude

- **Hooks de Claude Code**, que el propio `.exe` recibe con `desguaproterm.exe --hook` y reenvía a la app por `127.0.0.1` con una clave. Solo se aplican a las sesiones abiertas desde aquí (`--settings` en línea), así que tu configuración global no se toca.
- **Las transcripciones `.jsonl`** de `~/.claude/projects`: tokens, título, herramienta en uso y la carpeta `subagents/`.

## Atajos

| Atajo | Acción |
|---|---|
| `Ctrl+Shift+T` | Buscar proyecto |
| `Ctrl+Shift+N` | Otra sesión en la misma carpeta |
| `Ctrl+Shift+W` | Cerrar sesión (se puede deshacer) |
| `Ctrl+Shift+G` | Pestañas / cuadrícula |
| `Ctrl+Shift+A` | Panel de agentes |
| `Ctrl+Shift+B` | Barra lateral |
| `Ctrl+,` | Ajustes |
| `Ctrl+Tab`, `Alt+1…9` | Cambiar de sesión |
| `Shift+Enter` | Salto de línea en el mensaje |
| `Ctrl+rueda` | Tamaño de letra |

## Compilar e instalar

```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1
```

Compila, copia el `.exe` a `%LOCALAPPDATA%\Programs\desguaproterm` conservando tus datos y crea accesos directos.

## Todo dentro del .exe

Lo que cambia mientras la usas va en flujos de datos NTFS del propio archivo. Para verlos: `Get-Item desguaproterm.exe -Stream *`.

| Flujo | Contenido |
|---|---|
| `state.a` / `state.b` | Pestañas, favoritos y ajustes. Se alternan para que un corte de luz no los estropee. |
| `s-<pestaña>` | Conversación de cada pestaña |
| `titles` | Títulos ya resumidos |
| `window` | Posición de la ventana |
| `log` | Errores de la interfaz |

Se pierden al comprimir el `.exe` en .zip o al pasarlo a un USB FAT32; actualiza siempre con `instalar.ps1`. Fuera del `.exe` solo quedan la caché de WebView2 (`%TEMP%\desguaproterm-WebView2`) y, si la activas, la entrada de arranque con Windows.

Variables solo para pruebas:
- `CT_DATA_DIR`: guarda los datos en una carpeta.
- `CT_TEST_PROMPT`: arranca las sesiones nuevas con ese mensaje y con Haiku.
- `CT_TEST_UI=settings|trace`
