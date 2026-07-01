// ❌ RGAA 11.1 : champs de formulaire sans étiquettes associées
// ❌ RGAA 11.2 : placeholder utilisé comme seul label visible
// ❌ Design drift : couleurs et espacements non-tokenisés

export function ContactForm() {
  return (
    <section style={{ padding: '64px 32px', backgroundColor: '#f3f4f6' }}>
      <h2 style={{ color: '#111827', marginBottom: 32, textAlign: 'center' }}>
        Contactez-nous
      </h2>

      <form style={{ maxWidth: '480px', margin: '0 auto' }}>

        {/* ❌ Pas de <label> associé : l'input n'est identifié que par le placeholder (RGAA 11.1) */}
        <input
          type="text"
          name="name"
          placeholder="Votre nom"
          style={{ width: '100%', padding: '12px', marginBottom: '16px', border: '1px solid #d1d5db', borderRadius: '8px' }}
        />

        {/* ❌ Même problème sur l'email */}
        <input
          type="email"
          name="email"
          placeholder="votre@email.com"
          style={{ width: '100%', padding: '12px', marginBottom: '16px', border: '1px solid #d1d5db', borderRadius: '8px' }}
        />

        {/* ❌ Textarea sans label */}
        <textarea
          name="message"
          placeholder="Votre message..."
          rows={5}
          style={{ width: '100%', padding: '12px', marginBottom: '24px', border: '1px solid #d1d5db', borderRadius: '8px' }}
        />

        {/* ❌ Couleur de fond non-token (#5a5fcf ≈ brand.primary mais pas exactement) */}
        <button
          type="submit"
          style={{ width: '100%', backgroundColor: '#5a5fcf', color: '#ffffff', padding: '14px', border: 'none', borderRadius: '8px' }}
        >
          Envoyer
        </button>
      </form>
    </section>
  );
}
