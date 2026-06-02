const { SECTOR_REQUIRED_FIELDS, getCompletionStatus } = require('../src/lifecycle/sector-fields');

var pass = 0, fail = 0;
function check(label, condition, details) {
  if (condition) { console.log('✅', label); pass++; }
  else { console.error('❌', label, details || ''); fail++; }
}

// 1. Complete taller — has both required fields
var r1 = getCompletionStatus('taller', { matricula: '1234 ABC', fecha_ultimo_aceite: '2026-03-12' });
check('taller complete',           r1.status === 'complete',  JSON.stringify(r1));
check('taller complete no missing', r1.missing.length === 0,  JSON.stringify(r1));

// 2. Empty taller — no fields at all
var r2 = getCompletionStatus('taller', {});
check('taller empty',              r2.status === 'empty',           JSON.stringify(r2));
check('taller empty has matricula', r2.missing.includes('matricula'), JSON.stringify(r2));

// 3. Partial taller — has matricula but missing aceite
var r3 = getCompletionStatus('taller', { matricula: '1234 ABC' });
check('taller partial',            r3.status === 'partial', JSON.stringify(r3));
check('taller partial missing aceite', r3.missing.includes('fecha_ultimo_aceite'), JSON.stringify(r3));

// 4. Optional field (ITV) does NOT affect complete status
var r4 = getCompletionStatus('taller', { matricula: '1234', fecha_ultimo_aceite: '2026-01-01' });
check('taller complete without optional ITV', r4.status === 'complete', JSON.stringify(r4));

// 5. Sector with no required fields → no_fields
var r5 = getCompletionStatus('peluqueria', { tipo_servicio_habitual: 'corte' });
check('peluqueria no_fields',      r5.status === 'no_fields', JSON.stringify(r5));

// 6. Unknown sector → no_fields
var r6 = getCompletionStatus('restaurante', {});
check('unknown sector no_fields',  r6.status === 'no_fields', JSON.stringify(r6));

// 7. null sector_data
var r7 = getCompletionStatus('gimnasio', null);
check('null sector_data empty',    r7.status === 'empty', JSON.stringify(r7));

// 8. veterinaria complete (nombre_mascota required; vacuna optional)
var r8 = getCompletionStatus('veterinaria', { nombre_mascota: 'Tobi' });
check('veterinaria complete without optional vacuna', r8.status === 'complete', JSON.stringify(r8));

// 9. All sectors defined
var sectors = ['taller','veterinaria','gimnasio','fisioterapia','psicologia','optica','hotel','academia'];
sectors.forEach(function(s) {
  check('sector ' + s + ' defined in SECTOR_REQUIRED_FIELDS', !!SECTOR_REQUIRED_FIELDS[s]);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
