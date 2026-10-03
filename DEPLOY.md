# Publicar Shooter Stones en Render

El servidor actual admite dos conexiones simultáneas y usa Socket.IO. Para jugar desde casas distintas, publicá una sola instancia del servicio y ambos jugadores deben abrir la misma URL pública.

1. Subí este proyecto a un repositorio de GitHub que Render pueda leer.
2. En Render, elegí **New +** y luego **Blueprint**.
3. Conectá el repositorio y seleccioná la carpeta que contiene `render.yaml` si Render pregunta por el directorio raíz.
4. Confirmá la creación del servicio `shooter-stones` y esperá a que el despliegue termine.
5. Abrí la URL `https://...onrender.com` que Render asigna y compartí ese mismo enlace con tu amigo.
6. Para una partida online, ambos elijan **JUGAR**. Para jugar en solitario contra el bot, elegí **PRACTICAR CONTRA IA**.

El juego mantiene el estado de la partida en memoria y está configurado como una sola instancia. No escales el servicio a varias instancias: sin almacenamiento compartido, los jugadores podrían terminar en partidas distintas. En el plan gratuito, Render puede suspender el servicio cuando no se usa; la primera conexión después de una pausa puede tardar mientras vuelve a arrancar.
