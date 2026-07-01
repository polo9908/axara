// ❌ Design drift : couleurs et espacements codés en dur
// ❌ RGAA 6.1 : liens de navigation sans intitulé explicite sur mobile
// ❌ RGAA 12.6 : pas de lien d'évitement

export function Header() {
  return (
    <header style={{ backgroundColor: '#6366f1', padding: '16px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>

        {/* ❌ Logo : image sans alternative textuelle (RGAA 1.1) */}
        <img src="/logo.svg" style={{ height: '40px' }} />

        <nav>
          <ul style={{ display: 'flex', gap: '16px', listStyle: 'none' }}>
            <li><a href="/" style={{ color: '#ffffff' }}>Accueil</a></li>
            <li><a href="/features" style={{ color: '#ffffff' }}>Fonctionnalités</a></li>
            <li><a href="/pricing" style={{ color: '#ffffff' }}>Tarifs</a></li>
            {/* ❌ Lien vide sans texte (RGAA 6.1) */}
            <li><a href="/contact" style={{ color: '#ffffff' }}></a></li>
          </ul>
        </nav>

        {/* ❌ Bouton CTA sans type ni rôle clair, couleur non-token */}
        <button style={{ backgroundColor: '#f59e0b', color: '#111827', padding: '8px 20px' }}>
          Essai gratuit
        </button>
      </div>
    </header>
  );
}
