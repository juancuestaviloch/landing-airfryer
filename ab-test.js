/**
 * A/B Test Router — Sistema Cenas Air Fryer
 * 
 * Incluir este script en el <head> del index.html (la página de entrada).
 * Asigna al usuario al Grupo A (Control) o Grupo B (Variante Premium)
 * con un split 50/50, persistido en localStorage.
 * 
 * Uso en index.html:
 *   <script src="ab-test.js"></script>
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'ab_test_group_cenas';
    var VARIANT_URL = 'variant.html';

    // Si ya estamos en la variante, no redirigir (evitar loop)
    if (window.location.pathname.includes('variant')) return;

    var group = localStorage.getItem(STORAGE_KEY);

    if (!group) {
        // Primera visita: sortear grupo
        group = Math.random() < 0.5 ? 'A' : 'B';
        localStorage.setItem(STORAGE_KEY, group);
    }

    // Tracking (opcional: enviar a GA o Firestore)
    console.log('[AB Test] Grupo asignado:', group);

    if (group === 'B') {
        // Redirección instantánea antes de que el DOM se renderice
        window.location.replace(VARIANT_URL);
    }
})();
