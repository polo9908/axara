// ✅ Composant globalement bien structuré
// ❌ RGAA 3.2 : contraste texte insuffisant (gris clair sur blanc)
// ❌ Design drift : margin/padding non-tokenisés

interface PricingCardProps {
  plan: string;
  price: string;
  features: string[];
  highlighted?: boolean;
}

export function PricingCard({ plan, price, features, highlighted = false }: PricingCardProps) {
  return (
    <article
      style={{
        border: highlighted ? '2px solid #6366f1' : '1px solid #e5e7eb',
        borderRadius: '12px',   // ❌ non-token (token: radius.lg = 16px)
        padding: '32px',        // ✅ token space.8
        backgroundColor: '#ffffff',
      }}
    >
      <h2 style={{ color: '#111827', marginBottom: '8px' }}>{plan}</h2>

      <p style={{ fontSize: '36px', fontWeight: 'bold', color: '#6366f1', marginBottom: '24px' }}>
        {price}
      </p>

      {/* ❌ Contraste insuffisant : #9ca3af sur #ffffff ≈ 2.9:1 (WCAG AA exige 4.5:1) → RGAA 3.2 */}
      <p style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '16px' }}>
        par utilisateur / mois, facturé annuellement
      </p>

      <ul style={{ listStyle: 'none', marginBottom: '24px' }}>
        {features.map((f) => (
          // ❌ key manquant n'est pas un problème RGAA, mais la puce décorative n'a pas aria-hidden
          <li key={f} style={{ padding: '6px 0', color: '#374151' }}>
            <span>✓ </span>{f}
          </li>
        ))}
      </ul>

      {/* ✅ Bouton accessible avec type et label clair */}
      <button
        type="button"
        style={{
          width: '100%',
          backgroundColor: highlighted ? '#6366f1' : '#f3f4f6',
          color: highlighted ? '#ffffff' : '#111827',
          padding: '12px',
          border: 'none',
          borderRadius: '8px',  // ❌ non-token
          cursor: 'pointer',
        }}
      >
        Choisir {plan}
      </button>
    </article>
  );
}
