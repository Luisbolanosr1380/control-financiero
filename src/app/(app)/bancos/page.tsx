import { redirect } from 'next/navigation';

/**
 * PARTE 0 (brief Factoraje): la vieja página "Bancos" era un placeholder
 * del prototipo con un conteo de cuentas quemado en el código (en HIT, con
 * 0 bancos, mostraba un número falso). El módulo real de bancos es
 * Conciliación; esta ruta queda solo como redirect para marcadores viejos.
 */
export default function BancosRedirect() {
  redirect('/conciliacion');
}
