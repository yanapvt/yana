/**
 * MenuService
 *
 * Manages the interactive menu system for the WhatsApp concierge.
 *
 * Design decisions:
 * - Uses formatted text with numbered options (works in all WhatsApp environments
 *   including Twilio Sandbox, no template approval needed)
 * - Supports multi-intent: users can select multiple services in one session
 * - Menu selections are mapped to intents so the LLM is bypassed entirely
 * - State is stored in Redis session so context survives across messages
 */

// ============================================================================
// Types
// ============================================================================

export interface MenuItem {
  id: string;
  emoji: string;
  label: string;
  description: string;
  intent: string;
  /** Sub-menu items shown after this is selected (optional) */
  subItems?: SubMenuItem[];
}

export interface SubMenuItem {
  id: string;
  emoji: string;
  label: string;
  intent: string;
}

export interface MenuSelection {
  itemId: string;
  intent: string;
  label: string;
  /** true if this was a sub-menu selection */
  isSub: boolean;
}

// ============================================================================
// Main menu definition
// ============================================================================

export const MAIN_MENU: MenuItem[] = [
  {
    id: 'places',
    emoji: '🏖',
    label: 'Places to Visit',
    description: 'Beaches, temples, parks & hidden gems',
    intent: 'explore_places',
    subItems: [
      { id: 'places_beach',   emoji: '🌊', label: 'Beaches',        intent: 'explore_beaches'   },
      { id: 'places_temple',  emoji: '🛕', label: 'Temples & Culture', intent: 'explore_temples' },
      { id: 'places_nature',  emoji: '🌿', label: 'Nature & Wildlife', intent: 'explore_nature'  },
      { id: 'places_city',    emoji: '🏙', label: 'Cities & Towns',  intent: 'explore_cities'    },
    ],
  },
  {
    id: 'food',
    emoji: '🍛',
    label: 'Food & Restaurants',
    description: 'Local cuisine, street food & dining',
    intent: 'explore_food',
    subItems: [
      { id: 'food_local',     emoji: '🥘', label: 'Local Cuisine',   intent: 'explore_local_food'   },
      { id: 'food_street',    emoji: '🌮', label: 'Street Food',     intent: 'explore_street_food'  },
      { id: 'food_seafood',   emoji: '🦞', label: 'Seafood',         intent: 'explore_seafood'      },
      { id: 'food_vegetarian',emoji: '🥗', label: 'Vegetarian',      intent: 'explore_vegetarian'   },
    ],
  },
  {
    id: 'transport',
    emoji: '🚌',
    label: 'Transport',
    description: 'Tuk-tuks, trains, taxis & car hire',
    intent: 'explore_transport',
    subItems: [
      { id: 'transport_tuktuk', emoji: '🛺', label: 'Tuk-tuk',       intent: 'book_tuktuk'       },
      { id: 'transport_taxi',   emoji: '🚕', label: 'Taxi / Cab',    intent: 'book_taxi'         },
      { id: 'transport_train',  emoji: '🚂', label: 'Train',         intent: 'explore_trains'    },
      { id: 'transport_car',    emoji: '🚗', label: 'Car Hire',      intent: 'book_car_hire'     },
    ],
  },
  {
    id: 'hotels',
    emoji: '🏨',
    label: 'Hotels & Stays',
    description: 'Find and book accommodation',
    intent: 'search_hotels',
  },
  {
    id: 'culture',
    emoji: '🎭',
    label: 'Culture & Tips',
    description: 'Customs, festivals, safety & currency',
    intent: 'explore_culture',
    subItems: [
      { id: 'culture_customs',   emoji: '🙏', label: 'Customs & Etiquette', intent: 'explore_customs'   },
      { id: 'culture_festivals', emoji: '🎉', label: 'Festivals & Events',  intent: 'explore_festivals' },
      { id: 'culture_practical', emoji: '💡', label: 'Practical Tips',      intent: 'explore_tips'      },
    ],
  },
  {
    id: 'emergency',
    emoji: '🆘',
    label: 'Emergency & Help',
    description: 'Hospitals, police, embassy contacts',
    intent: 'emergency_help',
  },
];

// ============================================================================
// MenuService class
// ============================================================================

export class MenuService {
  /**
   * Render the main menu as a formatted WhatsApp text message.
   * Uses bold labels and numbered items — works in all WhatsApp clients.
   */
  renderMainMenu(): string {
    const lines: string[] = [
      "👋 Welcome to *Yana* — your Sri Lanka concierge!",
      "",
      "What can I help you with today? Reply with a number or just ask me anything:\n",
    ];

    MAIN_MENU.forEach((item, index) => {
      lines.push(`*${index + 1}.* ${item.emoji} ${item.label}`);
      lines.push(`    _${item.description}_`);
    });

    lines.push("");
    lines.push("💡 _You can also combine requests — e.g. \"hotels and transport in Galle\"_");

    return lines.join('\n');
  }

  /**
   * Render a sub-menu for a specific main menu item.
   */
  renderSubMenu(item: MenuItem): string {
    if (!item.subItems || item.subItems.length === 0) {
      return '';
    }

    const lines: string[] = [
      `${item.emoji} *${item.label}* — what specifically?\n`,
    ];

    item.subItems.forEach((sub, index) => {
      lines.push(`*${index + 1}.* ${sub.emoji} ${sub.label}`);
    });

    lines.push("");
    lines.push("_Or just describe what you're looking for!_");

    return lines.join('\n');
  }

  /**
   * Try to resolve a user message as a menu selection.
   * Returns the matched selection or null if it's not a menu pick.
   *
   * Handles:
   * - Single digit: "1", "2" etc.
   * - Digit with punctuation: "1.", "1)"
   * - Item ID: "hotels", "transport"
   * - Emoji shortcut: "🏨"
   */
  resolveMenuSelection(
    text: string,
    activeSubMenu?: string
  ): MenuSelection | null {
    const trimmed = text.trim().toLowerCase().replace(/[.)]/g, '');

    // ── Numeric selection ──────────────────────────────────────────────────
    const numMatch = trimmed.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1], 10) - 1;

      // If there's an active sub-menu, resolve against it
      if (activeSubMenu) {
        const parent = MAIN_MENU.find((m) => m.id === activeSubMenu);
        if (parent?.subItems && index >= 0 && index < parent.subItems.length) {
          const sub = parent.subItems[index];
          return { itemId: sub.id, intent: sub.intent, label: sub.label, isSub: true };
        }
      }

      // Otherwise resolve against main menu
      if (index >= 0 && index < MAIN_MENU.length) {
        const item = MAIN_MENU[index];
        return { itemId: item.id, intent: item.intent, label: item.label, isSub: false };
      }
    }

    // ── Text / ID match against main menu ─────────────────────────────────
    const byId = MAIN_MENU.find(
      (m) => m.id === trimmed || m.label.toLowerCase() === trimmed
    );
    if (byId) {
      return { itemId: byId.id, intent: byId.intent, label: byId.label, isSub: false };
    }

    // ── Emoji match ────────────────────────────────────────────────────────
    const byEmoji = MAIN_MENU.find((m) => text.trim().startsWith(m.emoji));
    if (byEmoji) {
      return { itemId: byEmoji.id, intent: byEmoji.intent, label: byEmoji.label, isSub: false };
    }

    return null;
  }

  /**
   * Detect multiple intents from a free-text message.
   * Returns an array of matched menu items (empty if none matched).
   *
   * Example: "I need hotels and transport in Galle"
   * → [{ id: 'hotels', intent: 'search_hotels' }, { id: 'transport', intent: 'explore_transport' }]
   */
  detectMultipleIntents(text: string): MenuItem[] {
    const lower = text.toLowerCase();
    const matched: MenuItem[] = [];

    for (const item of MAIN_MENU) {
      const keywords = this.getKeywordsForItem(item);
      if (keywords.some((kw) => lower.includes(kw))) {
        matched.push(item);
      }
    }

    return matched;
  }

  /**
   * Get the MenuItem for a given item ID.
   */
  getItemById(id: string): MenuItem | undefined {
    return MAIN_MENU.find((m) => m.id === id);
  }

  /**
   * Get the MenuItem for a given intent string.
   */
  getItemByIntent(intent: string): MenuItem | undefined {
    return MAIN_MENU.find(
      (m) => m.intent === intent || m.subItems?.some((s) => s.intent === intent)
    );
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getKeywordsForItem(item: MenuItem): string[] {
    const map: Record<string, string[]> = {
      places:    ['place', 'visit', 'see', 'attraction', 'beach', 'temple', 'park', 'sightseeing', 'tour'],
      food:      ['food', 'eat', 'restaurant', 'cuisine', 'meal', 'lunch', 'dinner', 'breakfast', 'snack', 'drink'],
      transport: ['transport', 'travel', 'get to', 'tuk', 'taxi', 'train', 'bus', 'car', 'ride', 'driver', 'uber'],
      hotels:    ['hotel', 'stay', 'accommodation', 'room', 'hostel', 'guesthouse', 'villa', 'resort', 'book'],
      culture:   ['culture', 'custom', 'festival', 'tip', 'etiquette', 'dress', 'currency', 'money', 'safety'],
      emergency: ['emergency', 'help', 'hospital', 'police', 'embassy', 'lost', 'stolen', 'sick', 'danger'],
    };
    return map[item.id] ?? [item.id, item.label.toLowerCase()];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let menuServiceInstance: MenuService | null = null;

export function getMenuService(): MenuService {
  if (!menuServiceInstance) {
    menuServiceInstance = new MenuService();
  }
  return menuServiceInstance;
}
