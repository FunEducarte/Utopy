# UTOPÝ ABI (v1)
Transporte: JSON Lines (stdin/stdout) o WebSocket con el mismo payload.

## Requests →
{"call":"aprender","nodo_id":"utopy.node@1","diccionario":{"🎥":"video","📄":"contrato"},"intents":[{"id":"firmar_contrato","requiere":["firmas"]}],"version":"1.0"}
{"call":"registrar_cap","nodo_id":"utopy.node@1","capability":{"id":"py.sensor.temp","kind":"percibir","claims":["sensor://temp"]},"version":"1.0"}
{"call":"interpretar","nodo_id":"utopy.node@1","señal":{"simbolo":"🌡️","payload":{"c":31}},"ctx":{"origen":"webrtc"},"version":"1.0"}

## Responses / events ←
{"ok":true,"ack":true,"version":"1.0"}
{"ok":true,"resonancias":[{"tipo":"medicion","valor":{"c":31},"universal":["dato_en_movimiento"]}],"version":"1.0"}
{"ok":false,"error":{"code":"E_RUNTIME","message":"..."},"version":"1.0"}
