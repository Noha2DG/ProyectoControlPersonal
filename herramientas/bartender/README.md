# Enlace con BarTender

La etiqueta de **cliente** (la de arte complejo que va a la Epson A4) la imprime BarTender, no el
sistema. Esta carpeta contiene lo que hace falta para que el botón **BarTender** de la pantalla
*Impresión de Etiquetas* abra la plantilla correcta con el rango de correlativos ya filtrado, y para
que BarTender avise de vuelta cuando de verdad imprimió.

```
Navegador                    PC del operador                     kronos
───────────────────────────────────────────────────────────────────────────────────
[BarTender]  ──oroetiqueta://──▶  abrirBartender.ps1
                                        │
                                        ▼
                                   BarTend.exe /F=plantilla.btw
                                     /?Orden /?Desde /?Hasta /?Token /FPD
                                        │
                                        │ ODBC (lectura)
                                        ├──────────────────────────▶ ColaEtiquetaBartender
                                        │
                                   el operador revisa y le da Imprimir
                                        │
                                        │ evento "Print Job Sent"
                                        ▼
                                   POST /api/etiqueta-impresa/bartender/impreso
                                        └──────────────────────────▶ ImpresoEn = ahora
```

Mientras no llegue ese POST, la pantalla muestra la captura como **Generadas** pero **0 en papel**:
generar un correlativo no imprime nada. Esa distinción existe porque antes no estaba, y una PC sin
el protocolo instalado mostraba la captura completa sin que hubiera salido una sola etiqueta.

---

## 1. Instalar en cada PC que imprima

Una vez **por usuario de Windows**, en cada PC. Se registra en HKCU, así que no pide administrador.

```powershell
powershell -ExecutionPolicy Bypass -File instalarProtocolo.ps1
```

Copia la carpeta a una ruta estable **antes** de instalar (por ejemplo `C:\OroEtiqueta\`): el
registro apunta al `.ps1` donde esté en ese momento, y si después se mueve, el protocolo se rompe.

Revisa las dos rutas del bloque de configuración de `abrirBartender.ps1`:

| Variable | Qué es | Valor actual |
|---|---|---|
| `$BarTendExe` | Dónde está instalado BarTender | `C:\Program Files\Seagull\BarTender 12.1\BarTend.exe` |
| `$CarpetaBtw` | Raíz autorizada de plantillas | `C:\Etiquetas` (en producción, la ruta UNC de la oficina) |

`$CarpetaBtw` tiene que coincidir con la raíz de las rutas guardadas en *Clientes y Subclientes*: si
la base dice `\servidor\etiquetas\...` y acá dice `C:\Etiquetas`, el manejador rechaza la plantilla
por estar fuera de la carpeta autorizada. Es a propósito — sin esa comprobación, una página
cualquiera podría pedirle a BarTender que abra un archivo arbitrario del disco.

Para probar sin abrir BarTender ni dejar ventanas colgando:

```powershell
powershell -ExecutionPolicy Bypass -File abrirBartender.ps1 `
  "oroetiqueta://imprimir?btw=C%3A%5CEtiquetas%5CGENERAL%5Cetiquetasmaster.btw&orden=56&desde=39&hasta=40" `
  -SinDialogo -Simular
```

Cada invocación queda en `%LOCALAPPDATA%\OroEtiqueta\abrirBartender.log` (el token va oculto).

Desinstalar: `powershell -ExecutionPolicy Bypass -File instalarProtocolo.ps1 -Desinstalar`

---

## 2. Configurar la plantilla `.btw`

Esto se hace **una vez por plantilla**, en BarTender Designer. Los nombres de menú están en inglés
porque así los documenta la ayuda del producto; si tienes la interfaz en español, son la traducción
directa.

### 2.1 Origen de datos

Conecta la plantilla por ODBC a la tabla **`ColaEtiquetaBartender`**. Los descriptivos ya vienen
congelados ahí (cliente, proceso, talla, lote, origen…), así que la plantilla no necesita unir nada:
cada fila es una etiqueta.

### 2.2 La consulta de la plantilla — sin solicitudes de consulta

Dos condiciones fijas, sin valores. Iguales en todos los diseños.

En **Filtro**, unidas con **Y**:

```
SolicitadoEn   No es nulo
ImpresoEn      es nulo
```

Y en **Criterio de ordenación**, `EtiquetaId` ascendente. Equivale a:

```sql
SELECT * FROM ColaEtiquetaBartender
WHERE SolicitadoEn IS NOT NULL AND ImpresoEn IS NULL
ORDER BY EtiquetaId
```

Deja `SELECT *`: los objetos de la plantilla se enlazan a los campos por nombre, y cambiar el
conjunto de columnas rompe los enlaces.

**Borra todas las solicitudes de consulta** que tenga la plantilla (`Orden`, `Desde`, `Hasta`,
`Token`, `Usuario`, `Reserva`). Ninguna se usa, y mientras exista una sin valor BarTender la va a
pedir a mano al imprimir — es la causa del cuadro *"Introducir datos de consulta"*.

La aplicación marca la tanda en la cola (`SolicitadoEn`) antes de abrir BarTender, así que la
plantilla no necesita saber nada del rango.

#### Limitación: una tanda a la vez

Reservar **suelta lo reservado antes**. Con una estación es correcto; con dos o más se pisan:

```
Estación A reserva E100–E150
Estación B reserva E200–E210   → suelta lo de A
Estación A imprime             → le salen las etiquetas de B
Estación A confirma            → marca E100–E150 sin que hayan salido
```

Papel equivocado y datos incorrectos, en silencio. **No pongas dos estaciones imprimiendo a la vez.**

Se probó una versión con un identificador por reserva (columna `ReservaId` y una solicitud
`?Reserva` en la plantilla) que lo resolvía, y se descartó en agosto 2026 porque volvía a meter una
solicitud de consulta en cada diseño — justo lo que costó más trabajo dejar atrás. Si más adelante
hacen falta varias estaciones, ese es el camino conocido.

### 2.2.1 Campos disponibles para el diseño

Cada concepto viaja con su **código** y su **descripción**. La descripción sirve para leer la
etiqueta; el código, para que el cliente o la aduana la crucen contra su propio catálogo.

| Concepto | Código | Descripción | Ejemplo |
|---|---|---|---|
| Cliente | `CodigoCliente` | `Cliente` | `14` · GOLD LAKE |
| Subcliente | `CodigoSubcliente` | `Subcliente` | `S032` · GOLDEN PROFIT SEA FOODS Co. LTD |
| Tipo de producto | `Clase` | `DescripcionClase` | `C20` · CULTIVO CABEZA ENTERO |
| Proceso | `CodigoProceso` | `Proceso` | `20` · ENTERO |
| Talla | `CodigoTalla` | `Talla` | `221` · 20/30 |
| Presentación | `CodigoPresentacion` | `Presentacion` | `MA` · 12/450 gr (5.4 kg) |
| Lote | — | `Lote` | G235Q002 |

Hay dos formas de "tipo de producto" porque son cosas distintas: la **clase** es la clasificación
completa del producto (`CULTIVO CABEZA ENTERO`) y el **proceso** es solo lo que se le hizo
(`ENTERO`). El diseño elige la que corresponda a cada cliente.

El resto de campos de la fila: `Correlativo`, `CodigoPedido`, `Color`, `Origen`, `Congelacion`,
`Area`, `FechaProduccion`.

Todos son valores **copiados**, no referencias: si mañana se edita el pedido, la fila conserva lo
que de verdad se imprimió. Eso es lo que uno quiere de un registro de trazabilidad.

Para usarlos en la plantilla: panel **Orígenes de datos** → nodo **Campos de la base de datos**, y
arrastra el campo al objeto de texto.

### 2.3 El aviso de impresión — DIFERIDO (agosto 2026)

> **Estado actual: la confirmación la da el operador, no BarTender.**
>
> Se decidió el 24 ago 2026, por tiempo. Al imprimir, la aplicación muestra un aviso
> ("¿salieron las etiquetas?") y el operador confirma; eso escribe `ImpresoEn` e `Impresora` con
> "Confirmado por <usuario>". Es el mismo flujo que el sistema anterior de la planta, que también
> confirmaba por mensaje sin saber si el papel salió.
>
> La acción de abajo quedó construida y probada hasta el punto de que **el evento se dispara y la
> petición llega al backend**; lo que faltó fue insertar las cuatro variables con el botón
> *Insertar variable* (teclear `%Nombre%` NO funciona dentro de una plantilla incrustada).
>
> Si la acción quedó creada en el `.btw`, ponla en **ficha Acción → Ejecutar acción → Nunca**. Así
> se conserva la configuración para retomarla, sin que cada impresión falle con el error #6724 ni
> gaste los reintentos. Borrarla también funciona, pero pierdes el trabajo hecho.
>
> Para retomarla: revisa que la URL apunte al backend real (durante las pruebas apuntaba a un proxy
> de diagnóstico en el puerto 3098, que ya no existe), y vuelve a poner *Ejecutar acción* en
> **Siempre**.

#### La acción, para cuando se retome


Menú **Archivo → Opciones del documento de BarTender → ficha Acciones**. Marca **Habilitar acciones
a nivel de documento** y haz clic en **Acciones de documento**.

En el panel **Eventos** elige **Trabajo de impresión enviado** (*"ocurre después de que el trabajo
de impresión se envía a la impresora"*) → **Nueva acción** → **Enviar solicitud de servicio web**:

| Campo | Valor |
|---|---|
| URL | ver el cuadro de abajo |
| Método | `POST` |
| Tipo de contenidos | `application/json` |
| Datos de contenidos | el JSON de abajo |
| Códigos de estado correctos | `200` |
| Recuento de reintentos | `3` |

La URL depende de contra qué backend estés trabajando. `kronos` es el nombre interno del servidor;
el nombre público — y el único que trae el certificado — es `datos.esteromar.app`:

| Entorno | URL |
|---|---|
| Producción | `https://datos.esteromar.app/api/etiqueta-impresa/bartender/impreso` |
| Pruebas en la PC de desarrollo | `http://localhost:3001/api/etiqueta-impresa/bartender/impreso` |

Si apuntas a `kronos.esteromar.app` el TLS falla (el certificado está emitido para
`datos.esteromar.app`), y si apuntas a producción antes de desplegar, el endpoint responde 404. En
los dos casos la etiqueta sale en papel y la pantalla se queda en **0 en papel**.

Los datos de contenidos se arman con **Insertar variable** (las solicitudes de consulta aparecen
bajo **Evento**, porque BarTender mapea solo los orígenes de datos con nombre a variables de
evento). Queda con esta forma:

```json
{
  "Token":  "<variable Token>",
  "Orden":  "<variable Orden>",
  "Desde":  "<variable Desde>",
  "Hasta":  "<variable Hasta>",
  "Impresora": "<variable del nombre de impresora>"
}
```

`Impresora` es opcional — si no encuentras la variable, quita esa línea y el resto funciona igual.
El rango del cuerpo es el que manda: si el operador lo estrechó en el diálogo de impresión, eso es
lo que se marca. El token solo pone el techo, y nunca deja marcar fuera de lo autorizado.

---

## 2.4 Una plantilla nueva: copia, no reconfigures

Configurar todo esto desde cero es tedioso y no hace falta más que una vez. Una copia del `.btw` se
lleva **todo**: la conexión, la instrucción SQL, las solicitudes de consulta, las acciones y el
diseño. Para un cliente nuevo:

1. Abre la plantilla terminada y **Archivo → Guardar como** con el nombre del cliente.
2. Cambia únicamente el arte.
3. En la aplicación, *Pedidos y Clientes → Clientes y Subclientes*, apunta ese cliente al archivo
   nuevo.

Eso es todo. Cero configuración de base de datos, cero solicitudes que crear.

Conviene además crear una **conexión a base de datos con nombre** (*Configuración de la base de
datos → Propiedades de la conexión → Crear conexión a base de datos con nombre*): guarda servidor y
credenciales en un solo lugar, así que el día que cambie el servidor lo editas una vez en vez de
plantilla por plantilla.

### Si de verdad hay que armar una desde cero

Por ejemplo, si un cliente manda su propio `.btw`. Con las respuestas ya conocidas son cinco
minutos:

1. Conéctala por ODBC a `ColaEtiquetaBartender` (o usa la conexión con nombre).
2. Crea cuatro solicitudes de consulta con estos **Nombres** exactos: `Orden`, `Desde`, `Hasta`,
   `Token`. Todas con *Actualizar el valor predeterminado después de la impresión* **desmarcada**.
3. En **Instrucción SQL**, marca *Especificar una instrucción SQL personalizada (avanzado)* y pega:

```sql
SELECT * FROM ColaEtiquetaBartender
WHERE OrdenId = ?Orden
  AND EtiquetaId BETWEEN ?Desde AND ?Hasta
  AND ImpresoEn IS NULL
ORDER BY EtiquetaId
```

4. Guarda el `.btw`.

Deja `SELECT *`: los objetos de la plantilla se enlazan a los campos por nombre, y cambiar el
conjunto de columnas rompe los enlaces.

El SQL personalizado se prefiere sobre el filtro visual porque se lee completo de un vistazo — los
errores que costaron la configuración inicial (un valor literal donde iba una solicitud, un operador
`Iguales` donde iba `Es menor o igual que`, una condición borrada sin querer) son invisibles en la
interfaz de condiciones y obvios en cuatro líneas de texto.

---

## 3. Qué pasa si algo falla

| Síntoma | Causa |
|---|---|
| El botón no hace nada, no hay bitácora | El protocolo no está registrado en esa PC/usuario → paso 1 |
| "No se encontró BarTender en…" | `$BarTendExe` apunta a otra versión |
| "La plantilla está fuera de la carpeta autorizada" | `$CarpetaBtw` no coincide con la ruta guardada en *Clientes y Subclientes* |
| Se abre la plantilla y el navegador dice `1 de 12` | No hay filtro en la plantilla (paso 2.2), falta el `/FPD`, o un prompt quedó con otro nombre |
| Imprime bien pero la pantalla sigue en **0 en papel** | La acción del evento *Trabajo de impresión enviado* no está puesta, o su URL no responde |

Para saber cuál de los dos es, prueba la URL a mano desde la PC que imprime:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri "<la URL de la acción>" -Method POST -ContentType "application/json" -Body "{}" -UseBasicParsing
```

Un **401** (*"Falta el token de impresión"*) es la respuesta correcta: el endpoint existe y responde.
Un **404** significa que ese backend todavía no tiene el código nuevo. Un error de TLS significa que
el nombre del host no coincide con el del certificado.
| "El permiso de impresión venció" en la bitácora de BarTender | El token dura 12 h; vuelve a abrir la plantilla desde la pantalla |

Para ver el estado real de una tanda:

```sql
SELECT Correlativo, ImpresoEn, Impresora
FROM ColaEtiquetaBartender
WHERE OrdenId = 56 ORDER BY EtiquetaId;
```

---

## Por qué el token y no las credenciales de la base

BarTender también sabe escribir por ODBC (acciones *Execute SQL* y *Update Database Records*), y
sería menos trabajo. No se hizo así porque el `.btw` vive en un recurso compartido que cualquiera
puede abrir en el Designer: con esa vía, el archivo llevaría dentro las credenciales de escritura a
producción. El token va firmado, trae el rango adentro, dura 12 horas y no sirve para nada más que
marcar ese tramo de esa captura.
