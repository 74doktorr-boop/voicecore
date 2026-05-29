#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate 12 new city+sector blog articles for NodeFlow."""
import os, json

BASE = r"C:\Users\unais\.gemini\antigravity\scratch\voicecore\public"
BLOG = os.path.join(BASE, "blog")

ARTICLES = [
    {
        "slug": "asistente-ia-psicologos-bilbao",
        "title": "Asistente IA para psicólogos y terapeutas en Bilbao",
        "desc": "Cómo un asistente de voz con IA ayuda a los psicólogos y terapeutas en Bilbao a gestionar citas, reducir no-shows y atender llamadas fuera de consulta.",
        "keywords": "asistente IA psicólogo Bilbao, recepcionista virtual terapeuta Bizkaia, automatizar citas psicología Bilbao",
        "sector": "psicologia",
        "city": "bilbao",
        "h2s": [
            ("¿Por qué los psicólogos de Bilbao necesitan un asistente IA?", "La consulta psicológica exige confidencialidad, discreción y disponibilidad. En Bilbao, donde la demanda de salud mental ha crecido un 40 % en los últimos tres años, muchos psicólogos y terapeutas pierden hasta el 30 % de sus llamadas entrantes por estar en sesión. Cada llamada perdida puede ser un paciente que busca ayuda urgente y acaba llamando a otro profesional. NodeFlow atiende esas llamadas con naturalidad, agenda citas y toma datos básicos sin interrumpir ninguna sesión."),
            ("Gestión de citas sin interrupciones en sesión", "El mayor dolor de cabeza de cualquier psicólogo es el teléfono que suena en medio de una sesión. Con NodeFlow, el asistente IA coge la llamada, saluda con el nombre de tu consulta, recoge el nombre del paciente, el motivo de contacto (primera vez, seguimiento, urgencia) y propone horarios disponibles. Todo en castellano o euskera, con un tono cálido y profesional que refleja los valores de tu consulta. Las citas se confirman por email automáticamente, y el recordatorio 24 h antes reduce los no-shows un 60 %."),
            ("Recordatorios y seguimiento automático", "Los pacientes de psicología tienen tasas de no-show más altas que otras especialidades, especialmente en primeras citas. NodeFlow envía recordatorios personalizados: 48 h antes con un mensaje de preparación, y 24 h antes con la confirmación. Si un paciente cancela, el sistema lo detecta y libera la franja automáticamente, ofreciendo el hueco a los pacientes en lista de espera. Este proceso, que antes requería llamadas manuales, ahora funciona solo."),
            ("Privacidad y cumplimiento RGPD en consultas de psicología", "Los datos de pacientes en salud mental son especialmente sensibles. NodeFlow está diseñado para recoger únicamente la información necesaria para la gestión de citas: nombre, teléfono y motivo general de contacto. Nunca graba conversaciones sin consentimiento explícito, y todos los datos se tratan conforme al RGPD. Las transcripciones de llamadas están disponibles en el portal del profesional, cifradas y accesibles solo por el titular."),
            ("Resultados reales: menos tiempo al teléfono, más tiempo en consulta", "Los psicólogos de Bilbao que usan NodeFlow recuperan de media 45 minutos al día que antes dedicaban a gestión telefónica. Ese tiempo se traduce en una sesión extra, menos estrés al final de la jornada, y mejores resultados clínicos. La inversión (desde €49/mes) se amortiza con una sola sesión adicional a la semana. ¿Listo para que tu consulta en Bilbao trabaje más inteligente?"),
        ],
        "faqs": [
            ("¿Puede el asistente IA atender en euskera?", "Sí. NodeFlow soporta castellano, euskera y modo bilingüe. Puedes configurar el idioma por defecto y permitir al asistente cambiar según la preferencia del paciente."),
            ("¿Es legal usar IA para citas de psicología?", "Completamente. El asistente IA solo gestiona la agenda y comunicaciones administrativas, no interviene en ningún aspecto clínico. Cumple el RGPD y la LOPDGDD."),
            ("¿Qué pasa si el paciente quiere hablar con el psicólogo directamente?", "El asistente puede transferir la llamada en tiempo real o dejar un aviso urgente para que el profesional devuelva la llamada. Tú defines la lógica de escalado."),
        ],
        "related": [
            ("/blog/recepcionista-ia-psicologos-terapeutas-espana", "IA para psicólogos en España"),
            ("/blog/asistente-ia-coaches-terapeutas", "IA para coaches y terapeutas"),
            ("/blog/automatizar-recordatorios-citas-reducir-no-shows", "Reducir no-shows con IA"),
        ],
    },
    {
        "slug": "asistente-ia-nutricionistas-bilbao",
        "title": "Recepcionista IA para nutricionistas en Bilbao — automatiza tu consulta",
        "desc": "Automatiza la gestión de citas de tu consulta de nutrición en Bilbao con IA. Recordatorios, seguimiento y atención 24/7 sin esfuerzo.",
        "keywords": "recepcionista IA nutricionista Bilbao, asistente virtual nutrición Bizkaia, automatizar citas nutriología Bilbao",
        "sector": "nutricion",
        "city": "bilbao",
        "h2s": [
            ("La consulta de nutrición en Bilbao: retos únicos de gestión", "Los nutricionistas en Bilbao atienden un volumen creciente de pacientes motivados por la cultura deportiva del País Vasco. Sin embargo, la gestión telefónica consume entre 1 y 2 horas diarias que podrían dedicarse a sesiones o formación. Las consultas de seguimiento, cambios de dieta y preguntas puntuales saturan el canal de llamadas. NodeFlow toma el control del teléfono y libera al profesional para lo que realmente importa."),
            ("Recordatorios de seguimiento personalizados", "La nutrición es un proceso a largo plazo: controles semanales, quincenales o mensuales. NodeFlow automatiza los recordatorios de cada revisión según el protocolo que defines. El paciente recibe un email o mensaje antes de su cita con indicaciones básicas (ayuno, traer diario alimentario) y el recordatorio reduce en un 55 % las ausencias no justificadas."),
            ("Gestión de primeras consultas y listas de espera", "Las primeras consultas de nutrición suelen tener demanda más alta que disponibilidad. Con NodeFlow, los nuevos pacientes se registran en lista de espera automáticamente y reciben notificación cuando hay un hueco. El asistente recoge datos previos (objetivo principal, alergias conocidas, si viene derivado) para que la primera consulta sea más eficiente."),
            ("Soporte multiidioma para el País Vasco", "Bilbao es una ciudad multilingüe. NodeFlow atiende en castellano y euskera de forma nativa, sin acentos artificiales ni confusiones culturales. Para las consultas de nutrición, el tono cálido y motivador del asistente refuerza la relación terapéutica desde el primer contacto."),
            ("Calcula tu ROI: ¿cuánto vale recuperar una hora al día?", "Si cobras €60/hora de consulta, recuperar una hora diaria de gestión telefónica equivale a €1.200 al mes en valor generado. NodeFlow cuesta desde €49/mes. El ROI es evidente desde el primer mes. Agenda una demo gratuita y compruébalo con tus números reales."),
        ],
        "faqs": [
            ("¿Puedo conectar NodeFlow con mi sistema de gestión de pacientes?", "Sí, mediante integración con Google Calendar o por API. Contacta con nosotros para explorar la integración con tu herramienta específica."),
            ("¿Cuánto tarda en configurarse para mi consulta?", "En menos de 24 horas puedes tener el asistente operativo con tus servicios, horarios y mensaje de bienvenida personalizado."),
            ("¿El asistente puede dar consejos nutricionales?", "No. El asistente gestiona exclusivamente la agenda y comunicaciones administrativas. No proporciona ni insinúa consejos de salud."),
        ],
        "related": [
            ("/blog/recepcionista-ia-nutricionistas-espana", "IA para nutricionistas en España"),
            ("/blog/automatizar-recordatorios-citas-reducir-no-shows", "Reducir no-shows con IA"),
            ("/blog/recepcionista-ia-psicologos-terapeutas-espana", "IA para psicólogos y terapeutas"),
        ],
    },
    {
        "slug": "asistente-ia-veterinaria-vitoria",
        "title": "Asistente IA para veterinarias en Vitoria-Gasteiz — atiende cada llamada",
        "desc": "Las veterinarias en Vitoria-Gasteiz pueden automatizar citas, recordatorios de vacunas y guardias de urgencia con un asistente de voz IA. Descubre cómo.",
        "keywords": "asistente IA veterinaria Vitoria, recepcionista virtual clínica veterinaria Álava, automatizar citas veterinario Gasteiz",
        "sector": "veterinarias",
        "city": "vitoria",
        "h2s": [
            ("El reto de la clínica veterinaria en Vitoria-Gasteiz", "Las veterinarias en Vitoria-Gasteiz atienden tanto mascotas urbanas como animales de entorno rural en Álava. La diversidad de casos —desde revisiones rutinarias hasta urgencias— genera un volumen de llamadas difícil de gestionar manualmente. En temporadas de campaña de vacunación, desparasitación o verano, las líneas colapsan. NodeFlow asegura que ninguna llamada quede sin respuesta, 24 horas al día."),
            ("Recordatorios de vacunas y desparasitaciones automáticos", "La fidelidad del cliente veterinario se construye sobre el seguimiento proactivo. NodeFlow envía recordatorios automáticos cuando se acerca la fecha de vacunación anual, la desparasitación trimestral o la revisión post-operatoria. El cliente recibe un email personalizado con el nombre de su mascota y los datos de la próxima visita. Este detalle genera confianza y reduce el riesgo de que la mascota quede sin protección por olvido."),
            ("Atención de urgencias fuera de horario", "Los animales no entienden de horarios de consulta. Con NodeFlow, las llamadas de urgencia fuera de guardia reciben respuesta inmediata con información sobre el protocolo de emergencias de tu clínica: teléfono de guardia, clínica de referencia 24 h o instrucciones básicas de primeros auxilios. El cliente siente que su clínica de confianza nunca le abandona."),
            ("Gestión de citas para múltiples veterinarios", "Las clínicas con dos o más profesionales en Vitoria necesitan coordinar agendas sin errores. NodeFlow gestiona la disponibilidad de cada veterinario por separado, evitando solapamientos y asegurando que cada paciente sea citado con el profesional correcto (especialista en exóticos, cirujano, internista). La agenda en Google Calendar se sincroniza en tiempo real."),
            ("De Vitoria al mundo: la IA que habla euskera", "Vitoria-Gasteiz es la capital de Álava y sede de muchas instituciones bilingües. NodeFlow atiende en castellano y euskera, lo que refuerza el vínculo con la comunidad local y diferencia tu clínica de las que solo ofrecen servicio en castellano."),
        ],
        "faqs": [
            ("¿Puede el asistente gestionar urgencias de noche?", "Sí. El asistente detecta palabras clave de urgencia ('mi perro no respira', 'accidente') y responde con el protocolo que hayas configurado: teléfono de guardia, clínica 24 h, etc."),
            ("¿Funciona para clínicas con especialistas en exóticos?", "Sí, puedes configurar especialidades y el asistente redirige las llamadas según el tipo de animal o procedimiento."),
            ("¿Cuánto cuesta para una clínica veterinaria en Vitoria?", "El plan Negocio (€49/mes) cubre llamadas ilimitadas, recordatorios y panel de control. Sin permanencia."),
        ],
        "related": [
            ("/blog/recepcionista-virtual-para-veterinarias-espana", "IA para veterinarias en España"),
            ("/blog/recepcionista-ia-veterinaria-bilbao", "IA veterinaria Bilbao"),
            ("/blog/recepcionista-ia-veterinaria-donostia", "IA veterinaria Donostia"),
        ],
    },
    {
        "slug": "asistente-ia-optica-bilbao",
        "title": "Asistente IA para ópticas en Bilbao — gestiona citas y revisiones visuales",
        "desc": "Las ópticas en Bilbao pueden automatizar citas de graduación, revisiones periódicas y recogida de gafas con un asistente de voz IA. Menos llamadas perdidas, más ventas.",
        "keywords": "asistente IA óptica Bilbao, recepcionista virtual óptica Bizkaia, automatizar citas revisión visual Bilbao",
        "sector": "optica",
        "city": "bilbao",
        "h2s": [
            ("La óptica en Bilbao y el reto de la agenda", "Las ópticas en Bilbao combinan servicio de salud visual con venta de óptica de moda. La demanda de revisiones, adaptaciones de lentillas y recogidas de gafas genera un flujo de llamadas constante que suele superar la capacidad de una sola persona en mostrador. NodeFlow gestiona todas esas llamadas en paralelo, agenda las citas de graduación con el optometrista y confirma la disponibilidad del producto sin esperas."),
            ("Recordatorios de revisión anual: el servicio que los clientes agradecen", "La revisión visual anual es recomendada para todos los usuarios de gafas o lentillas, pero muchos la posponen por falta de recordatorio. NodeFlow envía un email personalizado cada 12 meses ('Hola Ana, es momento de revisar tu graduación en Óptica X') que convierte clientes dormidos en citas activas. Este solo automatismo puede generar 3-5 visitas adicionales por semana."),
            ("Gestión de recogida de gafas y aviso al cliente", "Cuando las gafas llegan del laboratorio, el asistente puede generar un aviso automático por email o SMS al cliente para que pase a recogerlas. Esto agiliza el proceso, mejora la experiencia y libera al equipo de hacer llamadas de seguimiento manual."),
            ("Seguros ópticos: ¿tienes convenio con Adeslas, Sanitas o DKV?", "Muchos clientes llaman antes de venir para saber si su seguro tiene cobertura en tu óptica. NodeFlow responde automáticamente sobre los convenios que tienes activos: Adeslas, Sanitas, DKV, SegurCaixa, Mapfre. El asistente puede incluso pedir el número de afiliado y verificar si el seguro cubre la visita antes de confirmar la cita."),
            ("Facturación y ROI de la IA en tu óptica bilbaína", "Una óptica media en Bilbao factura entre €150 y €400 por visita (revisión + gafas). Recuperar 2-3 visitas semanales perdidas por llamadas no atendidas equivale a €1.200-€2.400 al mes. NodeFlow cuesta €49/mes. El ROI habla por sí solo."),
        ],
        "faqs": [
            ("¿Puede el asistente verificar coberturas de seguros ópticos?", "Puede dar información general sobre los seguros con los que trabajas. Para verificación en tiempo real, necesitarías integración con el sistema de tu gestor de seguros."),
            ("¿Funciona para ópticas con varios optometristas?", "Sí. Puedes configurar la agenda de cada profesional y el asistente asigna la cita al optometrista disponible."),
            ("¿El asistente habla euskera?", "Sí, NodeFlow soporta castellano, euskera y modo bilingüe."),
        ],
        "related": [
            ("/blog/asistente-ia-opticas-espana", "IA para ópticas en España"),
            ("/blog/recepcionista-ia-clinicas-seguros-privados-espana", "IA con seguros privados"),
            ("/blog/automatizar-recordatorios-citas-reducir-no-shows", "Reducir no-shows con IA"),
        ],
    },
    {
        "slug": "recepcionista-ia-autoescuela-bilbao",
        "title": "Recepcionista IA para autoescuelas en Bilbao — gestiona matrículas y clases prácticas",
        "desc": "Las autoescuelas en Bilbao pueden automatizar matrículas, clases prácticas y exámenes con un asistente de voz IA. Atención 24/7 sin perder ningún alumno potencial.",
        "keywords": "recepcionista IA autoescuela Bilbao, asistente virtual academia conducción Bizkaia, automatizar matrículas autoescuela Bilbao",
        "sector": "autoescuela",
        "city": "bilbao",
        "h2s": [
            ("Por qué las autoescuelas de Bilbao necesitan IA telefónica", "Las autoescuelas en Bilbao reciben su pico de llamadas en junio-julio y septiembre, cuando los estudiantes buscan sacar el carné antes del verano o al inicio del curso. Una sola recepcionista no puede atender todas las consultas simultáneas sobre precios, disponibilidad de clases y fechas de examen. NodeFlow responde todas esas llamadas en paralelo, nunca da señal de ocupado y convierte las consultas en matrículas."),
            ("Automatización de matrículas y reserva de clases prácticas", "El proceso de matriculación en una autoescuela implica varias llamadas: consulta inicial, entrega de documentación, pago, y coordinación de horarios de clase práctica. NodeFlow puede gestionar la primera fase (información y registro de interés) y coordinar con el equipo para las siguientes. Los alumnos que llaman fuera de horario dejan sus datos y son contactados al día siguiente con disponibilidad real."),
            ("Recordatorios de examen y reducción del nerviosismo", "Los alumnos de autoescuela suelen estar nerviosos antes del examen. NodeFlow envía recordatorios 48 h y 24 h antes con información práctica: lugar del examen, documentación necesaria, hora de presentación. Este detalle reduce las ausencias y mejora la experiencia del alumno, generando recomendaciones boca a boca."),
            ("Gestión de bajas temporales y reservas de plaza", "Algunos alumnos pausan su formación por trabajo, viajes o exámenes universitarios. NodeFlow puede gestionar estas pausas y mantener al alumno informado de su próxima disponibilidad para retomar las clases. Cuando el alumno quiere reincorporarse, el asistente comprueba disponibilidad y agenda directamente."),
            ("Diferénciate de otras autoescuelas en Bilbao con atención 24/7", "La mayoría de autoescuelas en Bilbao cierran a las 20:00 y los fines de semana. Si un estudiante busca información el domingo por la noche, tu autoescuela es la única que responde. Este diferencial competitivo puede valer varios alumnos al mes. La primera autoescuela que responde suele ser la que se lleva la matrícula."),
        ],
        "faqs": [
            ("¿Puede el asistente dar información sobre los precios y paquetes?", "Sí, configuras los precios y el asistente los comunica con precisión. También puede responder preguntas frecuentes sobre requisitos de edad, documentación necesaria, etc."),
            ("¿Funciona para autoescuelas con varias sucursales en Bilbao?", "Sí. Puedes configurar varias ubicaciones y el asistente redirige al alumno a la más conveniente."),
            ("¿Cómo se integra con mi software de autoescuela?", "NodeFlow se integra con Google Calendar. Para integración con software específico de autoescuelas, contacta con nosotros."),
        ],
        "related": [
            ("/blog/recepcionista-ia-autoescuelas-espana", "IA para autoescuelas en España"),
            ("/blog/ia-atencion-telefonica-pymes-espana", "IA telefónica para pymes"),
            ("/blog/como-no-perder-llamadas-negocio-euskadi", "No perder llamadas en Euskadi"),
        ],
    },
    {
        "slug": "asistente-ia-inmobiliaria-bilbao",
        "title": "Asistente IA para inmobiliarias en Bilbao — atiende consultas y coordina visitas",
        "desc": "Las inmobiliarias en Bilbao pueden automatizar la atención de consultas, filtrado de leads y coordinación de visitas con un asistente de voz IA. 24/7, sin perder ningún comprador potencial.",
        "keywords": "asistente IA inmobiliaria Bilbao, recepcionista virtual agencia inmobiliaria Bizkaia, automatizar visitas inmobiliaria Bilbao",
        "sector": "inmobiliarias",
        "city": "bilbao",
        "h2s": [
            ("El mercado inmobiliario en Bilbao y la velocidad de respuesta", "En el mercado inmobiliario de Bilbao —uno de los más dinámicos del norte de España— la velocidad de respuesta es decisiva. Un comprador potencial que llama a las 20:00 para preguntar por un piso en el Casco Viejo y no recibe respuesta, llamará a la siguiente agencia. NodeFlow responde inmediatamente, recoge los requisitos (zona, presupuesto, habitaciones) y agenda la visita directamente en tu agenda."),
            ("Filtrado de leads y calificación automática", "No todas las llamadas son compradores serios. NodeFlow puede realizar una calificación básica: ¿busca para comprar o alquilar?, ¿tiene financiación aprobada?, ¿en qué plazo quiere moverse? Con esta información, el agente recibe leads ya cualificados, optimizando su tiempo y esfuerzo en cada visita."),
            ("Coordinación de visitas y confirmaciones automáticas", "Coordinar visitas entre varios agentes y múltiples propiedades es un proceso propenso a errores y dobles reservas. NodeFlow sincroniza con el calendario del agente, propone horarios disponibles, confirma la visita por email y envía recordatorio 24 h antes. El cliente recibe la dirección exacta del inmueble y el nombre del agente que le atenderá."),
            ("Atención multiidioma para el mercado internacional de Bilbao", "Bilbao atrae compradores nacionales e internacionales, especialmente del resto de España, Francia y el norte de Europa. NodeFlow puede configurarse para atender en varios idiomas (castellano, euskera, inglés, francés), asegurando que ningún comprador internacional quede sin atención por barreras lingüísticas."),
            ("Medición de resultados: de llamada a visita a venta", "NodeFlow registra cada llamada, el resultado y si se agendó visita. Con estos datos, puedes medir tu tasa de conversión llamada→visita, identificar los horarios de mayor demanda y optimizar la cobertura de tu equipo. La información es tuya y está disponible en tiempo real en el panel de control."),
        ],
        "faqs": [
            ("¿Puede el asistente enviar información sobre propiedades?", "Puede dar información general que le proporciones (barrios, rangos de precio, características generales). Para enviar fichas de propiedades específicas, necesitarías integración con tu CRM inmobiliario."),
            ("¿Funciona para agencias con múltiples agentes?", "Sí. Puedes configurar la agenda de cada agente y el asistente asigna la visita al más disponible o al especialista en la zona consultada."),
            ("¿Cumple el RGPD para los datos de compradores?", "Sí. NodeFlow recoge solo la información necesaria para la gestión de visitas y lo hace con el consentimiento explícito del usuario."),
        ],
        "related": [
            ("/blog/ia-para-inmobiliarias-gestion-llamadas", "IA para inmobiliarias"),
            ("/blog/ia-recepcion-virtual-sector-servicios-espana", "Recepción virtual sector servicios"),
            ("/blog/como-no-perder-llamadas-negocio-euskadi", "No perder llamadas en Euskadi"),
        ],
    },
    {
        "slug": "asistente-ia-abogados-bilbao",
        "title": "Recepcionista IA para despachos de abogados en Bilbao — discreción y eficiencia",
        "desc": "Los despachos de abogados en Bilbao pueden automatizar la gestión de llamadas, citas y consultas iniciales con un asistente IA. Tono profesional, atención 24/7 y RGPD compliant.",
        "keywords": "recepcionista IA abogados Bilbao, asistente virtual despacho jurídico Bizkaia, automatizar citas abogado Bilbao",
        "sector": "abogados",
        "city": "bilbao",
        "h2s": [
            ("Los despachos de abogados en Bilbao y la primera impresión telefónica", "En el ámbito legal, la primera llamada a un despacho de abogados en Bilbao define la percepción del cliente. Una llamada sin respuesta o una atención apresurada puede costar un cliente de alto valor. NodeFlow garantiza que cada llamada sea atendida con un tono serio, profesional y cercano, recoge el motivo de consulta y agenda la primera reunión con el abogado más adecuado para el caso."),
            ("Gestión discreta de consultas confidenciales", "Los clientes de un despacho de abogados comparten información sensible desde la primera llamada. NodeFlow está diseñado con la discreción como prioridad: no almacena detalles del caso, solo los datos necesarios para la gestión de la cita (nombre, teléfono, área legal de interés). El abogado accede a esta información en su panel privado con acceso restringido."),
            ("Filtrado de áreas jurídicas y routing al especialista", "Un despacho de Bilbao puede tener especialistas en derecho laboral, mercantil, penal, familia y urbanismo. NodeFlow identifica el área de interés del cliente durante la llamada ('es por un despido', 'necesito ayuda con un divorcio') y lo dirige al especialista correspondiente, optimizando el tiempo de todos."),
            ("Recordatorios de reuniones y gestión de plazos", "Los abogados trabajan con plazos legales que no admiten olvidos. NodeFlow puede configurarse para enviar recordatorios de reuniones programadas y, en coordinación con el equipo, alertas de plazos críticos. El cliente nunca llega tarde a una reunión importante y el abogado nunca pierde un plazo por falta de comunicación."),
            ("Competitividad en Bilbao: la IA como ventaja diferencial", "Los despachos de abogados en Bilbao que adoptan tecnología IA se posicionan como innovadores y orientados al cliente. La disponibilidad 24/7 —esencial en situaciones de urgencia legal— y la atención en euskera son diferenciadores clave frente a despachos más tradicionales. NodeFlow, desde €49/mes, ofrece un servicio que antes solo estaba al alcance de los grandes bufetes."),
        ],
        "faqs": [
            ("¿Puede el asistente dar información legal básica?", "No. El asistente gestiona exclusivamente la agenda y comunicaciones administrativas, nunca proporciona asesoramiento legal. Esto es intencionado para proteger tanto al despacho como al cliente."),
            ("¿Funciona en euskera para clientes vascos?", "Sí. NodeFlow atiende en castellano, euskera y modo bilingüe."),
            ("¿Es compatible con el secreto profesional del abogado?", "Sí. El asistente recoge únicamente datos de contacto y área legal, sin detalles del caso. El abogado mantiene el control total de la información confidencial."),
        ],
        "related": [
            ("/blog/recepcionista-ia-despachos-abogados", "IA para despachos de abogados"),
            ("/blog/ia-recepcion-virtual-sector-servicios-espana", "Recepción virtual sector servicios"),
            ("/blog/ia-atencion-telefonica-pymes-espana", "IA telefónica para pymes"),
        ],
    },
    {
        "slug": "asistente-ia-fisioterapia-vitoria",
        "title": "Asistente IA para clínicas de fisioterapia en Vitoria-Gasteiz",
        "desc": "Las clínicas de fisioterapia en Vitoria-Gasteiz pueden automatizar citas, recordatorios de sesión y seguimiento de pacientes con un asistente de voz IA. Descubre cómo.",
        "keywords": "asistente IA fisioterapia Vitoria, recepcionista virtual clínica fisio Álava, automatizar citas fisioterapia Gasteiz",
        "sector": "fisioterapia",
        "city": "vitoria",
        "h2s": [
            ("Fisioterapia en Vitoria-Gasteiz: el volumen de llamadas que nadie gestiona", "Las clínicas de fisioterapia en Vitoria-Gasteiz atienden tanto deportistas del Deportivo Alavés y atletas amateur como pacientes post-operatorios y personas mayores con problemas crónicos. El teléfono suena constantemente —nuevos pacientes, seguimientos, cambios de cita, consultas sobre seguros— y el fisioterapeuta no puede contestar mientras está tratando. NodeFlow gestiona todas esas llamadas con naturalidad y eficiencia."),
            ("Gestión de tratamientos de varias sesiones", "La fisioterapia no es una cita única: son ciclos de 6, 10 o 20 sesiones. NodeFlow gestiona la cadena completa: agenda la primera evaluación, sugiere la frecuencia de tratamiento y programa automáticamente las siguientes sesiones. Si el paciente necesita cancelar una sesión, el asistente la reprograma manteniendo el protocolo de tratamiento."),
            ("Coordinación con seguros médicos: Adeslas, Sanitas, Asisa", "Muchos pacientes de fisioterapia en Vitoria tienen cobertura con Adeslas, Sanitas, Asisa o la OSI de Osakidetza. NodeFlow puede informar sobre los seguros con los que trabajas y solicitar el número de asegurado antes de confirmar la cita, agilizando el proceso de autorización. Esto reduce el tiempo de gestión administrativa hasta en un 40 %."),
            ("Recordatorios de sesión y reducción de no-shows", "Los no-shows en fisioterapia son especialmente costosos: cada hueco perdido es tiempo del fisioterapeuta sin facturar. NodeFlow envía recordatorios 24 h antes con confirmación por email. Si el paciente no confirma, el asistente hace un seguimiento adicional y libera el hueco para lista de espera si es necesario."),
            ("El futuro de la fisioterapia en Vitoria: más tratamiento, menos administración", "El fisioterapeuta promedio en Vitoria dedica entre 45 minutos y 1,5 horas diarias a gestión telefónica. Con NodeFlow, ese tiempo se recupera para lo que realmente importa: tratar pacientes, formar al equipo o desarrollar nuevos servicios. La inversión (€49/mes) se amortiza con una sola sesión adicional por semana."),
        ],
        "faqs": [
            ("¿Puede el asistente gestionar citas con varios fisioterapeutas?", "Sí. Configuras la agenda de cada profesional y el asistente asigna según disponibilidad o especialidad (deportiva, neurológica, pediátrica)."),
            ("¿Funciona con Google Calendar?", "Sí. Las citas se sincronizan en tiempo real con Google Calendar o cualquier sistema compatible."),
            ("¿El asistente habla euskera?", "Sí, NodeFlow soporta castellano, euskera y bilingüe. Vitoria-Gasteiz, como capital de Álava, tiene una alta proporción de hablantes de euskera."),
        ],
        "related": [
            ("/blog/recepcionista-virtual-clinica-fisioterapia", "IA para clínicas de fisioterapia"),
            ("/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia", "IA con seguros Adeslas/Sanitas"),
            ("/blog/automatizar-recordatorios-citas-reducir-no-shows", "Reducir no-shows con IA"),
        ],
    },
    {
        "slug": "asistente-ia-dental-vitoria",
        "title": "Recepcionista IA para clínicas dentales en Vitoria-Gasteiz — más pacientes, menos esperas",
        "desc": "Las clínicas dentales en Vitoria-Gasteiz pueden automatizar citas, recordatorios y gestión de seguros con un asistente de voz IA. Atención 24/7 y reducción de no-shows.",
        "keywords": "recepcionista IA clínica dental Vitoria, asistente virtual dentista Álava, automatizar citas odontología Gasteiz",
        "sector": "clinicas",
        "city": "vitoria",
        "h2s": [
            ("Las clínicas dentales en Vitoria-Gasteiz y la gestión de agenda", "Las clínicas dentales en Vitoria-Gasteiz trabajan con agendas muy ajustadas: tratamientos de ortodoncia, implantes y blanqueamientos que se programan con semanas de antelación, junto con urgencias que pueden presentarse cualquier día. Gestionar todo eso por teléfono mientras se atienden pacientes en sillón es prácticamente imposible. NodeFlow actúa como recepcionista virtual, atendiendo todas las llamadas en paralelo sin señal de ocupado."),
            ("Recordatorios y reducción de no-shows en ortodoncia e implantes", "Los no-shows en odontología tienen un coste especialmente alto: un sillón vacío durante 90 minutos puede suponer €200-€400 en ingresos perdidos. NodeFlow envía recordatorios personalizados 48 h y 24 h antes, con instrucciones específicas para cada tipo de tratamiento (ayuno para sedaciones, higiene previa para implantes). La tasa de no-shows cae hasta un 65 %."),
            ("Gestión de urgencias dentales: disponibilidad inmediata", "El dolor de muelas no espera. NodeFlow está disponible 24/7 y puede responder llamadas de urgencia con información sobre si tu clínica tiene disponibilidad de urgencias, cómo contactar en caso de urgencia grave o qué hacer hasta que puedan ser atendidos. Este servicio mejora radicalmente la fidelidad del paciente."),
            ("Integración con seguros dentales de Álava", "Asisa Dental, DentaBlue, Adeslas y otros seguros son habituales entre los pacientes de Vitoria-Gasteiz. NodeFlow informa sobre los convenios de tu clínica y solicita el número de asegurado al reservar cita, agilizando el proceso de autorización previa. Esto ahorra tiempo al paciente y al equipo de recepción."),
            ("Crecer en Vitoria con menos inversión en personal", "Contratar una segunda recepcionista en Vitoria cuesta entre €18.000 y €22.000 anuales en coste total. NodeFlow cuesta €49/mes (€588/año) y atiende más llamadas simultáneas de las que puede gestionar cualquier persona. El ahorro es inmediato y el ROI calculable desde el primer mes."),
        ],
        "faqs": [
            ("¿Puede el asistente gestionar las revisiones anuales automáticamente?", "Sí. Puedes programar recordatorios automáticos para revisiones anuales o semianuales, con el nombre del paciente y la clínica."),
            ("¿Funciona en euskera para pacientes vascos?", "Sí. NodeFlow atiende en castellano, euskera y modo bilingüe."),
            ("¿Se integra con el software de gestión dental (Carestream, Gesden)?", "La integración nativa se realiza a través de Google Calendar. Para integración profunda con software de gestión dental, contacta con nuestro equipo."),
        ],
        "related": [
            ("/blog/recepcionista-ia-clinica-dental-vitoria", "IA dental en Vitoria"),
            ("/blog/asistente-voz-clinica-dental-pais-vasco", "IA dental en el País Vasco"),
            ("/blog/recepcionista-ia-clinicas-seguros-privados-espana", "IA con seguros privados"),
        ],
    },
    {
        "slug": "asistente-ia-centros-pilates-espana",
        "title": "Asistente IA para centros de pilates en España — automatiza reservas y reducción de bajas",
        "desc": "Los centros de pilates en España pueden automatizar reservas de clase, recordatorios y gestión de bonos con un asistente IA. Menos bajas, más fidelidad.",
        "keywords": "asistente IA pilates España, recepcionista virtual centro pilates, automatizar reservas clases pilates",
        "sector": "pilates",
        "city": None,
        "h2s": [
            ("El pilates en España: el sector que crece pero lucha con la gestión", "El pilates es uno de los sectores de bienestar con mayor crecimiento en España. Sin embargo, muchos centros siguen gestionando reservas por WhatsApp, email o llamadas, generando caos administrativo y bajas por falta de seguimiento. NodeFlow automatiza todas esas comunicaciones y convierte la gestión del centro en un proceso fluido y profesional."),
            ("Reservas de clase fáciles: por teléfono o 24/7", "Los alumnos de pilates tienen vidas ocupadas y necesitan poder reservar (y cancelar) a cualquier hora. NodeFlow atiende llamadas fuera de horario, gestiona el aforo de cada clase, listas de espera y cambios de horario. La alumna que llama a las 22:00 para cambiar su clase del jueves por la del martes obtiene respuesta inmediata."),
            ("Reducción de bajas: el poder del recordatorio inteligente", "Las bajas en los centros de pilates suelen producirse tras una ausencia de 2-3 semanas. NodeFlow detecta cuándo un alumno lleva tiempo sin venir y envía un mensaje proactivo: '¡Te echamos de menos! Tenemos plazas disponibles esta semana para que retomes tu práctica.' Este recordatorio puede reducir la tasa de bajas hasta un 35 %."),
            ("Gestión de bonos, abonos y tarifas especiales", "Los centros de pilates ofrecen múltiples tarifas: clase suelta, bono 10, mensualidad, tarifa matinal. NodeFlow informa correctamente sobre cada tarifa, gestiona las consultas de saldo de bono y puede alertar cuando el bono está a punto de agotarse para renovarlo proactivamente."),
            ("Del pilates suelo a reformer: personaliza el asistente a tu centro", "Cada centro de pilates es diferente. NodeFlow se configura con los servicios específicos de tu centro: pilates suelo, reformer, duet, pre y post parto, pilates terapéutico. El asistente conoce tu oferta y responde con precisión a cada consulta."),
        ],
        "faqs": [
            ("¿Puede el asistente gestionar el aforo de cada clase?", "Sí, en coordinación con Google Calendar o tu sistema de reservas. El asistente verifica disponibilidad antes de confirmar la plaza."),
            ("¿Funciona para centros con varias sedes?", "Sí. Puedes configurar múltiples localizaciones y el asistente dirige al alumno a la sede más conveniente."),
            ("¿Cuánto cuesta para un centro de pilates?", "El plan Negocio es €49/mes sin permanencia. Incluye llamadas ilimitadas, recordatorios y panel de control."),
        ],
        "related": [
            ("/blog/asistente-ia-centros-yoga-pilates", "IA para yoga y pilates"),
            ("/blog/automatizar-recordatorios-citas-reducir-no-shows", "Automatizar recordatorios de clase"),
            ("/blog/asistente-ia-para-gimnasios-centros-deportivos", "IA para gimnasios y centros deportivos"),
        ],
    },
    {
        "slug": "como-elegir-ia-voz-negocio-espana-2026",
        "title": "Cómo elegir el mejor asistente de voz IA para tu negocio en España (2026)",
        "desc": "Guía completa para elegir un asistente de voz IA para tu negocio en España: criterios clave, comparativa de funcionalidades y lo que realmente importa en 2026.",
        "keywords": "elegir asistente voz IA negocio España, comparativa IA telefónica pyme, mejor recepcionista virtual 2026",
        "sector": None,
        "city": None,
        "h2s": [
            ("¿Por qué cada vez más pymes españolas adoptan IA telefónica en 2026?", "En 2026, la IA de voz para negocios ha dejado de ser una tecnología de futuro para convertirse en una herramienta cotidiana. El 67 % de los españoles prefiere llamar a un negocio antes que escribir un email o mensaje, y el 42 % abandona si nadie contesta. Las pymes que adoptan asistentes de voz IA recuperan esas llamadas perdidas, reducen costes de personal y mejoran la experiencia del cliente de forma medible."),
            ("Los 5 criterios más importantes al elegir un asistente IA", "Antes de decidirte, evalúa estos cinco aspectos: (1) Calidad de la voz — ¿suena natural o robótica?; (2) Idiomas soportados — fundamental si necesitas euskera, gallego o catalán; (3) Integración con tu agenda — Google Calendar, Outlook o tu software de gestión; (4) Personalización — ¿puedes configurar el nombre del asistente, el saludo, los servicios y los horarios?; (5) Precio y escalabilidad — ¿el coste crece con tu negocio o es fijo?"),
            ("Señales de alarma que debes evitar", "Desconfía de soluciones que: requieren contratos de permanencia de 12 meses o más; no ofrecen prueba gratuita ni demo en vivo; tienen precios opacos con costes por llamada no comunicados; no tienen soporte en español ni adaptación al mercado local; no cumplen el RGPD o no tienen política de privacidad clara."),
            ("¿Cuánto debería costar un buen asistente IA para pymes?", "El rango justo para una pyme española en 2026 está entre €49 y €99 al mes para un servicio completo: llamadas ilimitadas, recordatorios automáticos, panel de control y soporte. Por debajo de €30 suelen ser soluciones limitadas. Por encima de €200 suelen ser plataformas enterprise con funcionalidades que la mayoría de pymes no necesita."),
            ("NodeFlow: diseñado desde el principio para el negocio español", "NodeFlow nació en el País Vasco con un propósito claro: hacer accesible la IA de voz para las pymes españolas. Soporta castellano, euskera y gallego de forma nativa, cumple el RGPD, tiene precios transparentes (Negocio €49/mes, Pro €99/mes) y se configura en menos de 24 horas. Sin permanencia, sin costes ocultos."),
        ],
        "faqs": [
            ("¿Qué diferencia hay entre un chatbot y un asistente de voz IA?", "Un chatbot gestiona texto (WhatsApp, web). Un asistente de voz IA gestiona llamadas telefónicas con voz natural. Son canales complementarios, no sustitutos."),
            ("¿El asistente IA puede manejar llamadas en euskera o gallego?", "NodeFlow sí. La mayoría de plataformas genéricas no están adaptadas a las lenguas cooficiales del Estado."),
            ("¿Es legal usar IA para atender llamadas de clientes en España?", "Sí, cumpliendo el RGPD e informando al usuario de que está hablando con un sistema automatizado. NodeFlow gestiona esto automáticamente."),
        ],
        "related": [
            ("/blog/diferencia-chatbot-asistente-voz-ia", "Chatbot vs asistente de voz IA"),
            ("/blog/cuanto-cuesta-recepcionista-virtual-ia", "Cuánto cuesta un recepcionista IA"),
            ("/blog/ia-atencion-telefonica-pymes-espana", "IA telefónica para pymes"),
        ],
    },
    {
        "slug": "asistente-ia-yoga-bilbao",
        "title": "Asistente IA para centros de yoga en Bilbao — más alumnos, menos gestión",
        "desc": "Los centros de yoga en Bilbao pueden automatizar reservas, recordatorios y comunicación con alumnos usando un asistente de voz IA. Descubre cómo.",
        "keywords": "asistente IA yoga Bilbao, recepcionista virtual centro yoga Bizkaia, automatizar reservas yoga Bilbao",
        "sector": "yoga",
        "city": "bilbao",
        "h2s": [
            ("El yoga en Bilbao: comunidad activa, gestión compleja", "Bilbao tiene una comunidad de yoga especialmente activa, con estudios que ofrecen desde hatha y vinyasa hasta yin yoga y meditación. Sin embargo, gestionar reservas para 6-8 clases diarias de diferentes estilos, con niveles distintos y aforos limitados, es un trabajo administrativo intenso. NodeFlow automatiza esa gestión para que el profesor pueda centrarse en enseñar."),
            ("Gestión de plazas y listas de espera", "Las clases más populares (flow matutino, yin nocturno) se llenan rápidamente. NodeFlow gestiona el aforo en tiempo real: cuando una clase está completa, registra al alumno en lista de espera y le notifica automáticamente cuando se libera una plaza. Este proceso, antes manual, ocurre solo."),
            ("Comunicación de cambios de horario y sustituciones", "Cuando un profesor se pone enfermo o hay un evento especial, el centro necesita comunicarlo rápidamente a todos los alumnos afectados. NodeFlow puede enviar notificaciones masivas por email a los alumnos inscritos en una clase concreta, manteniendo la comunicación sin esfuerzo manual."),
            ("Integración con la filosofía del centro: tono cálido y consciente", "Un centro de yoga no es una empresa más; tiene una identidad y valores propios. NodeFlow se personaliza con el tono de voz y los valores de tu estudio: cálido, cercano, sin prisas. El asistente puede saludar usando el nombre del alumno y adaptar el mensaje a la energía de tu espacio."),
            ("Crecer sin crecer el equipo: la IA como herramienta de escala", "Un estudio de yoga que pasa de 50 a 100 alumnos no tiene por qué contratar un administrativo. NodeFlow escala sin coste adicional: gestiona 10 llamadas simultáneas igual que una. El crecimiento de tu estudio no tiene por qué implicar más burocracia."),
        ],
        "faqs": [
            ("¿Puede el asistente gestionar packs de clases y abonos mensuales?", "Puede informar sobre los packs y precios. Para gestión de saldo de bonos necesitarías integración con tu sistema de gestión."),
            ("¿Funciona para estudios pequeños de un solo profesor?", "Perfectamente. Muchos estudios pequeños son los que más se benefician porque liberan al propio profesor de la gestión telefónica."),
            ("¿Atiende en euskera?", "Sí. NodeFlow soporta castellano y euskera nativos."),
        ],
        "related": [
            ("/blog/asistente-ia-centros-yoga-pilates", "IA para yoga y pilates"),
            ("/blog/automatizar-recordatorios-citas-reducir-no-shows", "Automatizar recordatorios de clase"),
            ("/blog/asistente-ia-para-gimnasios-centros-deportivos", "IA para gimnasios y centros deportivos"),
        ],
    },
]


def make_article_html(a):
    slug    = a["slug"]
    title   = a["title"]
    desc    = a["desc"]
    kw      = a["keywords"]
    h2s     = a["h2s"]
    faqs    = a["faqs"]
    related = a["related"]

    breadcrumb_label = title[:50] + "…" if len(title) > 50 else title

    h2_items = ""
    for h2, body in h2s:
        h2_items += f"""
      <h2>{h2}</h2>
      <p>{body}</p>
"""

    faq_items = ""
    faq_schema = ""
    for i, (q, ans) in enumerate(faqs):
        faq_items += f"""
        <div class="faq-item" onclick="this.classList.toggle('open')">
          <div class="faq-q">{q} <span class="faq-icon">+</span></div>
          <div class="faq-a">{ans}</div>
        </div>"""
        faq_schema += f"""        {{
          "@type": "Question",
          "name": "{q}",
          "acceptedAnswer": {{"@type": "Answer", "text": "{ans}"}}
        }}{"," if i < len(faqs)-1 else ""}
"""

    rel_links = "\n      ".join(
        f'<a href="{href}" style="font-size:14px;padding:10px 18px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--accent-l);background:rgba(124,58,237,0.06);transition:all .2s;text-decoration:none">{label} →</a>'
        for href, label in related
    )

    toc = "\n".join(
        f'          <li><a href="#sec{i+1}" style="color:var(--accent-l);text-decoration:none">{h2}</a></li>'
        for i, (h2, _) in enumerate(h2s)
    )

    sections_with_ids = ""
    for i, (h2, body) in enumerate(h2s):
        sections_with_ids += f"""
      <h2 id="sec{i+1}">{h2}</h2>
      <p>{body}</p>
"""

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} | NodeFlow</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="{desc}">
  <meta name="keywords" content="{kw}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://nodeflow.es/blog/{slug}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="https://nodeflow.es/blog/{slug}">
  <meta property="og:image" content="https://nodeflow.es/og-image.png">
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@graph": [
      {{
        "@type": "Article",
        "headline": "{title}",
        "description": "{desc}",
        "author": {{"@type": "Organization", "name": "NodeFlow"}},
        "publisher": {{"@type": "Organization", "name": "NodeFlow", "url": "https://nodeflow.es"}},
        "datePublished": "2026-05-29",
        "dateModified": "2026-05-29",
        "url": "https://nodeflow.es/blog/{slug}"
      }},
      {{
        "@type": "BreadcrumbList",
        "itemListElement": [
          {{"@type": "ListItem", "position": 1, "name": "Inicio", "item": "https://nodeflow.es"}},
          {{"@type": "ListItem", "position": 2, "name": "Blog", "item": "https://nodeflow.es/blog"}},
          {{"@type": "ListItem", "position": 3, "name": "{breadcrumb_label}", "item": "https://nodeflow.es/blog/{slug}"}}
        ]
      }},
      {{
        "@type": "FAQPage",
        "mainEntity": [
{faq_schema}        ]
      }}
    ]
  }}
  </script>
  <!-- GA4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZPKHPG2BLC"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-ZPKHPG2BLC');</script>
  <!-- Plausible -->
  <script defer data-domain="nodeflow.es" src="https://plausible.io/js/script.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{{--bg:#07070e;--card:#14141e;--accent:#6c5ce7;--accent-l:#a29bfe;--white:#f0f0f5;--text:#c8c8d8;--dim:#8888a8;--border:rgba(255,255,255,0.07)}}
    *,*::before,*::after{{margin:0;padding:0;box-sizing:border-box}}
    html{{scroll-behavior:smooth}}
    body{{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.7;overflow-x:hidden}}
    .progress-bar{{position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#6c5ce7,#a29bfe);width:0%;z-index:1000;transition:width .1s}}
    .noise{{position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:180px;opacity:0.025}}
    .orb{{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0;width:500px;height:500px;top:-150px;left:-100px;background:radial-gradient(circle,rgba(108,92,231,0.18) 0%,transparent 70%)}}
    nav{{position:fixed;top:0;left:0;right:0;z-index:100;padding:14px 0}}
    nav::before{{content:'';position:absolute;inset:0;background:rgba(7,7,14,0.88);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}}
    .nav-inner{{display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1;max-width:780px;margin:0 auto;padding:0 24px}}
    .logo{{font-size:18px;font-weight:800;color:var(--white);text-decoration:none}}
    .logo em{{color:var(--accent-l);font-style:normal}}
    .btn{{display:inline-flex;align-items:center;padding:8px 18px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:all .2s}}
    .btn-primary{{background:var(--accent);color:#fff}}.btn-primary:hover{{background:#7c6cf7}}
    .container{{max-width:780px;margin:0 auto;padding:0 24px;position:relative;z-index:2}}
    .breadcrumb{{padding:100px 0 0;font-size:12px;color:var(--dim)}}
    .breadcrumb a{{color:var(--dim);text-decoration:none}}.breadcrumb a:hover{{color:var(--accent-l)}}
    h1{{font-size:clamp(26px,5vw,46px);font-weight:900;letter-spacing:-1.5px;color:var(--white);margin:18px 0 14px;line-height:1.15}}
    .meta{{font-size:13px;color:var(--dim);margin-bottom:28px}}
    .toc{{background:rgba(108,92,231,0.07);border:1px solid rgba(108,92,231,0.2);border-radius:12px;padding:20px 24px;margin-bottom:36px}}
    .toc-title{{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent-l);margin-bottom:10px}}
    .toc ol{{padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:14px}}
    .article-body{{font-size:16px;line-height:1.75}}
    .article-body h2{{font-size:clamp(18px,3vw,26px);font-weight:800;color:var(--white);margin:42px 0 14px;letter-spacing:-.5px}}
    .article-body p{{margin-bottom:18px}}
    .cta-mid{{background:linear-gradient(135deg,rgba(108,92,231,.12),rgba(162,155,254,.06));border:1px solid rgba(108,92,231,.2);border-radius:16px;padding:28px 32px;margin:40px 0;text-align:center}}
    .cta-mid h3{{font-size:20px;font-weight:800;color:var(--white);margin-bottom:8px}}
    .cta-mid p{{color:var(--dim);margin-bottom:18px;font-size:15px}}
    .faq-section{{margin-top:48px}}
    .faq-section h2{{font-size:22px;font-weight:800;color:var(--white);margin-bottom:20px}}
    .faq-item{{border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;cursor:pointer}}
    .faq-q{{padding:14px 18px;font-size:15px;font-weight:600;color:var(--white);display:flex;justify-content:space-between;align-items:center}}
    .faq-a{{display:none;padding:0 18px 14px;font-size:14px;color:var(--dim);line-height:1.6}}
    .faq-icon{{color:var(--accent-l);font-size:20px;line-height:1;transition:transform .2s}}
    .faq-item.open .faq-a{{display:block}}
    .faq-item.open .faq-icon{{transform:rotate(45deg)}}
    .related-section{{padding:40px 0 80px}}
    .related-section h2{{font-size:18px;font-weight:700;color:var(--white);margin-bottom:16px}}
    .related-links{{display:flex;flex-wrap:wrap;gap:10px}}
    footer{{border-top:1px solid var(--border);padding:28px 0}}
    .footer-inner{{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center}}
    .footer-links{{display:flex;gap:14px;flex-wrap:wrap}}
    .footer-links a{{font-size:12px;color:var(--dim);text-decoration:none}}
    .footer-copy{{font-size:11px;color:rgba(136,136,168,0.5)}}
    .wa-float{{position:fixed;bottom:24px;right:24px;z-index:200;width:52px;height:52px;border-radius:50%;background:#25d366;display:flex;align-items:center;justify-content:center;font-size:26px;text-decoration:none;box-shadow:0 4px 20px rgba(37,211,102,0.45);transition:transform .2s}}
    .wa-float:hover{{transform:scale(1.1)}}
    @media(max-width:600px){{.cta-mid{{padding:20px 18px}}h1{{letter-spacing:-1px}}}}
  </style>
</head>
<body>
<div class="progress-bar" id="pb"></div>
<div class="noise"></div>
<div class="orb"></div>

<nav>
  <div class="nav-inner">
    <a href="https://nodeflow.es" class="logo">Node<em>Flow</em></a>
    <a href="https://nodeflow.es/#contacto" class="btn btn-primary">Empezar gratis →</a>
  </div>
</nav>

<div class="container">
  <div class="breadcrumb">
    <a href="https://nodeflow.es">Inicio</a> › <a href="/blog">Blog</a> › {breadcrumb_label}
  </div>

  <h1>{title}</h1>
  <div class="meta">NodeFlow · 29 mayo 2026 · 6 min lectura</div>

  <div class="toc">
    <div class="toc-title">📋 Contenido</div>
    <ol>
{toc}
      <li><a href="#faq" style="color:var(--accent-l);text-decoration:none">Preguntas frecuentes</a></li>
    </ol>
  </div>

  <article class="article-body">
{sections_with_ids}
    <div class="cta-mid">
      <h3>¿Listo para automatizar tu negocio?</h3>
      <p>Configura tu asistente IA en menos de 24 horas. Sin permanencia, sin costes ocultos.</p>
      <a href="https://nodeflow.es/#contacto" class="btn btn-primary">Empezar gratis →</a>
    </div>

    <section class="faq-section" id="faq">
      <h2>❓ Preguntas frecuentes</h2>
{faq_items}
    </section>
  </article>
</div>

<section style="padding:40px 0 80px;background:var(--bg);">
  <div class="container">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;color:var(--white)">📚 Artículos relacionados</h2>
    <div style="display:flex;flex-wrap:wrap;gap:10px;">
      {rel_links}
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div class="footer-inner">
      <div style="font-weight:700;font-size:14px">⚡ Node<span style="color:var(--accent-l)">Flow</span></div>
      <div class="footer-links">
        <a href="https://nodeflow.es">Inicio</a>
        <a href="/blog">Blog</a>
        <a href="https://nodeflow.es/privacidad">Privacidad</a>
        <a href="https://nodeflow.es/terminos">Términos</a>
      </div>
      <div class="footer-copy">© 2026 NodeFlow · hola@nodeflow.es</div>
    </div>
  </div>
</footer>

<a href="https://wa.me/34666351319" class="wa-float" target="_blank" rel="noopener" title="WhatsApp NodeFlow">💬</a>

<script>
(function(){{
  var pb = document.getElementById('pb');
  window.addEventListener('scroll', function(){{
    var scrolled = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
    pb.style.width = Math.min(scrolled, 100) + '%';
  }});
}})();
</script>
</body>
</html>
"""


def main():
    created = 0
    for a in ARTICLES:
        slug = a["slug"]
        out_dir = os.path.join(BLOG, slug)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "index.html")
        html = make_article_html(a)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  Created: {slug}")
        created += 1
    print(f"\nDone. Created {created} articles.")

    # Update topics.json
    topics_path = os.path.join(BLOG, "topics.json")
    with open(topics_path, "r", encoding="utf-8") as f:
        topics = json.load(f)

    existing_slugs = {t["slug"] for t in topics}
    added = 0
    for a in ARTICLES:
        if a["slug"] not in existing_slugs:
            topics.append({
                "slug": a["slug"],
                "title": a["title"],
                "keywords": [k.strip() for k in a["keywords"].split(",")][:3],
                "focus": a["desc"],
                "sector": a["sector"],
                "city": a["city"],
                "generated": True,
            })
            added += 1

    with open(topics_path, "w", encoding="utf-8") as f:
        json.dump(topics, f, ensure_ascii=False, indent=2)
    print(f"topics.json updated — {added} entries added. Total: {len(topics)}")


if __name__ == "__main__":
    main()
