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
    // Funeral & memorial
    'Choosing hymns for a funeral service',
    'The most requested funeral hymns in Britain — and why they endure',
    'Why Abide With Me remains the most-loved funeral hymn',
    'The Lord\'s My Shepherd: why Crimond moves a congregation',
    'Music for a crematorium service: what actually works',
    'How live choral music transforms a memorial service',
    'Planning music for a celebration of life',
    'Sacred vs secular music for funerals — how to decide',
    'Five things your funeral director won\'t tell you about music',
    'Why live music matters more than recordings at a funeral',
    'How to personalise a funeral with meaningful music',
    'Music for committal: choosing the right moment',
    'A guide to music for humanist and non-religious funerals',
    'Classical choral pieces that work beautifully at funerals',
    'Catholic funeral music: tradition, repertoire, and what to expect',
    'How many singers do you need? A guide to choir sizes for funerals',
    'The entry of the coffin: why the first music matters most',
    'What to tell your choir: briefing musicians for a funeral',
    // Wedding
    'What to expect from a professional choir at your wedding',
    'Music for every moment of your wedding ceremony',
    'The difference between a quartet and a full choir at a wedding',
    'Choosing wedding hymns your congregation can actually sing',
    'Choral repertoire for the signing of the register',
    'How to match choir size to your wedding venue',
    'The role of the organist at a wedding ceremony',
    // Seasonal & occasions
    'Seasonal hymns: what works for winter and Christmas services',
    'Christmas memorial services: music, atmosphere, and remembrance',
    'Music for a corporate carol service or office celebration',
  ],

  // Template variants (randomly selected per post)
  templates: ['listicle', 'seasonal', 'did-you-know', 'testimonial'],

  // API versions (update here when platforms change their API)
  api: {
    linkedInVersion: '202602',
    graphApiVersion: 'v25.0',
  },

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
  },
};
