// Ce composant crée intentionnellement un PIÈGE CLAVIER (focus trap sans sortie)
// pour tester la détection Playwright de l'étape 4.
//
// ❌ RGAA 7.3 : le focus est piégé dans la modale (Tab ne peut pas en sortir)
// ❌ RGAA 11.9 : bouton de fermeture sans intitulé explicite (juste "×")
// ❌ Design drift : couleurs codées en dur

interface ModalProps {
  title: string;
  onClose: () => void;
}

export function Modal({ title, onClose }: ModalProps) {
  return (
    // ❌ pas de role="dialog", pas d'aria-modal, pas d'aria-labelledby
    <div
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          padding: '32px',
          width: '480px',
          maxWidth: '90vw',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: '#111827' }}>{title}</h2>
          {/* ❌ Bouton sans intitulé accessible — le "×" seul n'est pas suffisant (RGAA 11.9) */}
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>
            ×
          </button>
        </div>

        <p style={{ color: '#374151', marginBottom: '24px' }}>
          Confirmez-vous votre inscription à l'offre NovaTech Pro ?
        </p>

        {/* Ces deux boutons créent le piège si on intercepte Tab via JS */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            style={{ flex: 1, backgroundColor: '#6366f1', color: '#ffffff', padding: '12px', border: 'none', borderRadius: '8px' }}
          >
            Confirmer
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, backgroundColor: '#f3f4f6', color: '#111827', padding: '12px', border: 'none', borderRadius: '8px' }}
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
