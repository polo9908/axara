// ✅ Structure sémantique correcte (h1 présent)
// ❌ Design drift : gradient codé en dur, padding non-token
// ❌ RGAA 9.1 : h1 vide (dépend d'une expression dynamique sans fallback)

export function HeroSection({ title }: { title?: string }) {
  return (
    <section
      style={{
        // ❌ Couleurs codées en dur (non-token)
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        padding: '80px 32px',
        textAlign: 'center',
      }}
    >
      {/* ❌ Pas de contenu statique fiable — axe peut signaler un h1 vide */}
      <h1 style={{ color: '#ffffff', fontSize: '48px', marginBottom: '20px' }}>
        {title}
      </h1>

      <p style={{ color: '#e0e7ff', fontSize: '20px', marginBottom: '40px' }}>
        La plateforme SaaS qui automatise votre conformité accessibilité.
      </p>

      {/* ❌ Deux liens consécutifs identiques vers la même URL (RGAA 6.1) */}
      <a href="/signup" style={{ backgroundColor: '#f59e0b', color: '#111827', padding: '14px 28px', marginRight: '12px' }}>
        Commencer maintenant
      </a>
      <a href="/signup" style={{ backgroundColor: 'transparent', color: '#ffffff', padding: '14px 28px', border: '2px solid #ffffff' }}>
        Commencer maintenant
      </a>
    </section>
  );
}
