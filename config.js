// scripts/config.js
// Central configuration for the LCS carousel pipeline

export const CONFIG = {
  // Slide dimensions (4:5 portrait — best engagement ratio)
  slide: {
    width: 1080,
    height: 1350,
  },

  // Number of slides per carousel
  slideCount: 6, // 1 hook + 4 content + 1 CTA

  // Brand colours
  brand: {
    primary: '#1a1a2e',       // deep navy
    secondary: '#c9a84c',     // gold
    accent: '#f5f0e8',        // warm cream
    text: '#1a1a2e',          // navy text
    textLight: '#f5f0e8',     // cream text (on dark backgrounds)
    highlight: '#8b1a1a',     // burgundy accent
  },

  // Typography (Google Fonts — loaded in templates)
  fonts: {
    display: 'Playfair Display',
    body: 'Source Serif 4',
    accent: 'Cormorant Garamond',
  },

  // Content generation
  topics: [
    'Choosing hymns for a funeral service',
    'What to expect from a professional choir at your wedding',
    'The most requested funeral hymns in the UK',
    'How live choral music transforms a memorial service',
    'Planning music for a celebration of life',
    'Sacred vs secular music for funerals — how to decide',
    'Five things your funeral director won\'t tell you about music',
    'Why live music matters more than recordings at a funeral',
    'Seasonal hymns: what works for winter funerals',
    'How to personalise a funeral with meaningful music',
    'The difference a professional choir makes at a wedding ceremony',
    'Music for committal: choosing the right moment',
    'What families say about live choral music at funerals',
    'A guide to music for humanist funeral ceremonies',
    'Classical choral music that works beautifully at funerals',
  ],

  // Template variants (randomly selected per post)
  templates: ['listicle', 'seasonal', 'did-you-know', 'testimonial'],

  // Platform-specific settings
  platforms: {
    linkedin: {
      enabled: true,
      format: 'pdf',          // LinkedIn organic carousels = PDF documents
      maxFileSize: 100_000_000, // 100MB
    },
    instagram: {
      enabled: true,
      format: 'png',
      maxImages: 10,
    },
    facebook: {
      enabled: true,
      format: 'png',
    },
    tiktok: {
      enabled: true,
      format: 'png',
    },
  },
};
