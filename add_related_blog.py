#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Add related-blog sections to all 27 sector pages before <!-- CTA --> comment."""
import os

BASE = r"C:\Users\unais\.gemini\antigravity\scratch\voicecore\public"

def make_related_section(links):
    link_html = '\n      '.join(
        f'<a href="{href}" style="font-size:14px;padding:10px 18px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--accent-l);background:rgba(124,58,237,0.06);transition:all .2s;text-decoration:none">{label} →</a>'
        for href, label in links
    )
    return f'''<!-- RELATED BLOG -->
<section style="padding:48px 0;background:var(--bg);">
  <div class="container">
    <h2 style="font-size:20px;font-weight:700;margin-bottom:20px;color:var(--white)">📚 Artículos relacionados</h2>
    <div style="display:flex;flex-wrap:wrap;gap:12px;">
      {link_html}
    </div>
  </div>
</section>

'''

MAPPING = {
    'fisioterapia': [
        ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Cómo reducir no-shows con IA'),
        ('/blog/asistente-ia-fisioterapia-donostia', 'IA para fisio en Donostia'),
        ('/blog/fisioterapia-seguros-adeslas-sanitas-asistente-ia', 'IA con seguros Adeslas/Sanitas'),
    ],
    'clinicas': [
        ('/blog/asistente-voz-clinica-dental-pais-vasco', 'IA dental en el País Vasco'),
        ('/blog/recepcionista-ia-clinica-dental-bilbao', 'IA dental en Bilbao'),
        ('/blog/recepcionista-ia-clinicas-seguros-privados-espana', 'IA con seguros privados'),
    ],
    'peluquerias': [
        ('/blog/recepcionista-ia-peluqueria-bilbao', 'IA para peluquerías en Bilbao'),
        ('/blog/recepcionista-ia-peluqueria-donostia', 'IA peluquería Donostia'),
        ('/blog/asistente-ia-peluqueria-coloracion-citas-largas', 'IA para citas de coloración'),
    ],
    'veterinarias': [
        ('/blog/recepcionista-virtual-para-veterinarias-espana', 'IA para veterinarias'),
        ('/blog/recepcionista-ia-veterinaria-bilbao', 'IA veterinaria Bilbao'),
        ('/blog/recepcionista-ia-veterinaria-donostia', 'IA veterinaria Donostia'),
    ],
    'talleres': [
        ('/blog/recepcionista-ia-taller-mecanico-bilbao', 'IA para talleres en Bilbao'),
        ('/blog/recepcionista-ia-taller-vitoria', 'IA taller Vitoria'),
        ('/blog/asistente-ia-taller-mecanico-donostia', 'IA taller Donostia'),
    ],
    'estetica': [
        ('/blog/asistente-ia-centros-estetica-laser', 'IA para estética avanzada'),
        ('/blog/asistente-ia-estetica-vitoria-gasteiz', 'IA estética Vitoria'),
        ('/blog/asistente-ia-clinica-estetica-donostia', 'IA estética Donostia'),
    ],
    'gimnasios': [
        ('/blog/asistente-ia-para-gimnasios-centros-deportivos', 'IA para gimnasios'),
        ('/blog/asistente-ia-gimnasio-bilbao', 'IA gimnasio Bilbao'),
        ('/blog/asistente-ia-gimnasio-donostia', 'IA gimnasio Donostia'),
    ],
    'restaurantes': [
        ('/blog/automatizar-reservas-restaurante-donostia', 'Reservas automáticas Donostia'),
        ('/blog/asistente-ia-restaurante-vitoria', 'IA restaurante Vitoria'),
        ('/blog/recepcionista-ia-restaurante-bilbao', 'IA restaurante Bilbao'),
    ],
    'hoteles': [
        ('/blog/asistente-virtual-hoteles-rurales-espana', 'IA para hoteles rurales'),
        ('/blog/ia-multiidioma-turismo-pais-vasco', 'IA multiidioma turismo vasco'),
    ],
    'academias': [
        ('/blog/asistente-ia-academia-vitoria', 'IA academia Vitoria'),
        ('/blog/ia-para-academias-clases-particulares', 'IA para academias'),
        ('/blog/recepcionista-ia-academias-idiomas-espana', 'IA academias idiomas'),
    ],
    'farmacias': [
        ('/blog/recepcionista-ia-farmacias-espana', 'IA para farmacias'),
        ('/blog/recepcionista-ia-farmacia-bilbao', 'IA farmacia Bilbao'),
        ('/blog/asistente-ia-farmacia-donostia', 'IA farmacia Donostia'),
    ],
    'asesorias': [
        ('/blog/recepcionista-ia-asesorias-gestoras-espana', 'IA para asesorías'),
        ('/blog/ia-recepcion-virtual-sector-servicios-espana', 'Recepción virtual sector servicios'),
    ],
    'inmobiliarias': [
        ('/blog/ia-para-inmobiliarias-gestion-llamadas', 'IA para inmobiliarias'),
        ('/blog/ia-recepcion-virtual-sector-servicios-espana', 'Recepción virtual sector servicios'),
    ],
    'optica': [
        ('/blog/asistente-ia-opticas-espana', 'IA para ópticas en España'),
        ('/blog/recepcionista-ia-clinicas-seguros-privados-espana', 'IA con seguros ópticos'),
    ],
    'psicologia': [
        ('/blog/recepcionista-ia-psicologos-terapeutas-espana', 'IA para psicólogos'),
        ('/blog/asistente-ia-coaches-terapeutas', 'IA para coaches y terapeutas'),
    ],
    'nutricion': [
        ('/blog/recepcionista-ia-nutricionistas-espana', 'IA para nutricionistas'),
        ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Reducir no-shows con IA'),
    ],
    'podologia': [
        ('/blog/recepcionista-ia-podologos-espana', 'IA para podólogos'),
        ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Reducir no-shows con IA'),
    ],
    'autoescuela': [
        ('/blog/recepcionista-ia-autoescuelas-espana', 'IA para autoescuelas'),
        ('/blog/ia-atencion-telefonica-pymes-espana', 'IA telefónica para pymes'),
    ],
    'estetica-avanzada': [
        ('/blog/asistente-ia-centros-estetica-laser', 'IA centros estética láser'),
        ('/blog/asistente-ia-estetica-vitoria-gasteiz', 'IA estética en Vitoria'),
        ('/blog/asistente-ia-spa-balneario-espana', 'IA para spas'),
    ],
    'yoga': [
        ('/blog/asistente-ia-centros-yoga-pilates', 'IA para yoga y pilates'),
        ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Automatizar recordatorios de clase'),
    ],
    'pilates': [
        ('/blog/asistente-ia-centros-yoga-pilates', 'IA para yoga y pilates'),
        ('/blog/automatizar-recordatorios-citas-reducir-no-shows', 'Automatizar recordatorios de clase'),
    ],
    'guarderia-canina': [
        ('/blog/asistente-ia-guarderias-caninas', 'IA para guarderías caninas'),
        ('/blog/recepcionista-virtual-para-veterinarias-espana', 'IA veterinaria y cuidado animal'),
    ],
    'abogados': [
        ('/blog/recepcionista-ia-despachos-abogados', 'IA para despachos de abogados'),
        ('/blog/ia-recepcion-virtual-sector-servicios-espana', 'Recepción virtual sector servicios'),
    ],
    'notaria': [
        ('/blog/recepcionista-ia-notarias-espana', 'IA para notarías'),
        ('/blog/ia-recepcion-virtual-sector-servicios-espana', 'Recepción virtual servicios profesionales'),
    ],
    'agencia-viajes': [
        ('/blog/asistente-ia-agencias-viajes-espana', 'IA para agencias de viajes'),
        ('/blog/ia-multiidioma-turismo-pais-vasco', 'IA multiidioma turismo'),
    ],
    'reformas': [
        ('/blog/asistente-ia-empresas-reformas-espana', 'IA para empresas de reformas'),
        ('/blog/ia-atencion-telefonica-pymes-espana', 'IA telefónica para pymes'),
    ],
    'coaching': [
        ('/blog/asistente-ia-coaches-terapeutas', 'IA para coaches y terapeutas'),
        ('/blog/recepcionista-ia-psicologos-terapeutas-espana', 'IA para psicólogos'),
    ],
}

def process_sector(sector, links):
    file_path = os.path.join(BASE, sector, 'index.html')
    if not os.path.exists(file_path):
        print(f'  SKIP (not found): {sector}')
        return False

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    marker = '<!-- CTA -->'
    if marker not in content:
        # Try lowercase
        marker = '<!-- cta -->'
        if marker not in content:
            print(f'  WARN (no CTA marker): {sector} — inserting before </footer>')
            marker = '</footer>'
            if marker not in content:
                print(f'  ERROR (no footer either): {sector}')
                return False

    related_section = make_related_section(links)
    new_content = content.replace(marker, related_section + marker, 1)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'  Updated: {sector}')
    return True

def main():
    updated = 0
    for sector, links in MAPPING.items():
        if process_sector(sector, links):
            updated += 1
    print(f'\nDone. Updated {updated}/{len(MAPPING)} sector pages.')

if __name__ == '__main__':
    main()
