/**
 * MenuService
 *
 * Manages the interactive menu system for the WhatsApp concierge.
 *
 * Two rendering modes:
 * 1. TEXT MENU  — numbered list, works everywhere including Twilio Sandbox
 * 2. BUTTON MENU — real WhatsApp interactive buttons via Twilio Content API
 *    Triggered by the keyword "test" for demo/verification purposes.
 *    Button payloads come back as ButtonPayload in the Twilio webhook body.
 *
 * Button hierarchy (4 levels, max 3 buttons per message per WhatsApp limits):
 *
 * Level 1 — Main Menu
 *   🚀 Get Around  |  🍴 Enjoy & Explore  |  🧳 Stay & Essentials
 *
 * Level 2 — Category
 *   Get Around:        Airport & Transfers | Local Transport  | Travel Planning
 *   Enjoy & Explore:   Food & Dining       | Activities       | Events & Shopping
 *   Stay & Essentials: Accommodation       | Travel Essentials| Help & Special
 *
 * Level 3 — Sub-category
 *   Airport:           Airport Pickup | Drop-off      | Private Driver
 *   Local Transport:   Taxi / Ride    | Car Rental    | Public Transport
 *   Travel Planning:   Route Planning | Traffic Check | Multi-city Travel
 *   Food & Dining:     Restaurants    | Local Food    | Delivery
 *   Activities:        Tours          | Adventure     | Cultural
 *   Events & Shopping: Events         | Shopping      | Tickets
 *   Accommodation:     Book Stay      | Manage Booking| Requests
 *   Travel Essentials: SIM / Internet | Money Exchange| Packing Needs
 *   Help & Special:    Emergency      | Medical       | Special Requests
 *
 * Level 4 — Leaf actions (examples)
 *   Restaurants:       Fine Dining    | Casual        | Budget
 *   Adventure:         Water Sports   | Hiking        | Safari
 *   Special Requests:  Birthday       | Proposal      | Custom Plan
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
// Button tree types (for interactive WhatsApp button menus)
// ============================================================================

/**
 * A node in the interactive button hierarchy.
 * Each node has up to 3 children (WhatsApp button limit).
 * Leaf nodes have no children — they map to a final intent/action.
 */
export interface ButtonNode {
  /** Unique ID sent back as ButtonPayload when tapped */
  id: string;
  /** Button title — max 20 chars (WhatsApp limit) */
  title: string;
  /** Message body shown above the buttons */
  body: string;
  /** Child nodes (up to 3). Empty = leaf node */
  children: ButtonNode[];
  /** Intent to set in session when this leaf is reached */
  intent?: string;
}

/**
 * A renderable button message — body text + up to 3 button definitions.
 */
export interface ButtonMessage {
  body: string;
  buttons: Array<{ id: string; title: string }>;
}

// ============================================================================
// Interactive button hierarchy
// ============================================================================

/**
 * Full 4-level button tree.
 * IDs must be unique across the entire tree — they are used as ButtonPayload
 * values returned by Twilio when the user taps a button.
 */
export const BUTTON_TREE: ButtonNode = {
  id: 'root',
  title: 'Open Menu',
  body: '👋 Welcome to *Yana* — your Sri Lanka concierge!\n\nWhat would you like to do?',
  children: [
    // ── Level 1: Get Around ──────────────────────────────────────────────
    {
      id: 'get_around',
      title: '🚀 Get Around',
      body: '🚀 *Get Around*\n\nHow can I help you travel?',
      children: [
        {
          id: 'airport',
          title: 'Airport & Transfers',
          body: '✈️ *Airport & Transfers*\n\nWhat do you need?',
          children: [
            { id: 'pickup',   title: 'Airport Pickup',  body: '🛬 *Airport Pickup*\n\nI\'ll help you arrange a pickup. Where are you arriving?', children: [], intent: 'book_airport_pickup' },
            { id: 'dropoff',  title: 'Drop-off',        body: '🛫 *Drop-off*\n\nI\'ll help you arrange a drop-off. When do you need it?',       children: [], intent: 'book_airport_dropoff' },
            { id: 'driver',   title: 'Private Driver',  body: '🚗 *Private Driver*\n\nTell me your itinerary and I\'ll find you a driver.',       children: [], intent: 'book_private_driver' },
          ],
        },
        {
          id: 'local_transport',
          title: 'Local Transport',
          body: '🚕 *Local Transport*\n\nHow would you like to get around?',
          children: [
            { id: 'taxi',   title: 'Taxi / Ride',      body: '🚕 *Taxi / Ride*\n\nWhere would you like to go?',                    children: [], intent: 'book_taxi' },
            { id: 'rental', title: 'Car Rental',       body: '🚗 *Car Rental*\n\nHow many days do you need a car?',                children: [], intent: 'book_car_hire' },
            { id: 'public', title: 'Public Transport', body: '🚌 *Public Transport*\n\nWhere are you heading? I\'ll find the best route.', children: [], intent: 'explore_trains' },
          ],
        },
        {
          id: 'travel_planning',
          title: 'Travel Planning',
          body: '🗺️ *Travel Planning*\n\nWhat do you need help planning?',
          children: [
            { id: 'route',      title: 'Route Planning',    body: '🗺️ *Route Planning*\n\nTell me your start and end points.',          children: [], intent: 'plan_route' },
            { id: 'traffic',    title: 'Traffic Check',     body: '🚦 *Traffic Check*\n\nWhich route or area would you like to check?', children: [], intent: 'check_traffic' },
            { id: 'multi_city', title: 'Multi-city Travel', body: '🏙️ *Multi-city Travel*\n\nWhich cities are you planning to visit?',  children: [], intent: 'plan_multi_city' },
          ],
        },
      ],
    },

    // ── Level 1: Enjoy & Explore ─────────────────────────────────────────
    {
      id: 'explore',
      title: '🍴 Enjoy & Explore',
      body: '🍴 *Enjoy & Explore*\n\nWhat are you in the mood for?',
      children: [
        {
          id: 'food',
          title: 'Food & Dining',
          body: '🍛 *Food & Dining*\n\nWhat kind of food experience?',
          children: [
            {
              id: 'restaurants',
              title: 'Restaurants',
              body: '🍽️ *Restaurants*\n\nWhat type of dining?',
              children: [
                { id: 'fine',   title: 'Fine Dining', body: '🥂 *Fine Dining*\n\nWhich city or area are you in?',    children: [], intent: 'explore_fine_dining' },
                { id: 'casual', title: 'Casual',      body: '🍜 *Casual Dining*\n\nWhich city or area are you in?', children: [], intent: 'explore_casual_dining' },
                { id: 'budget', title: 'Budget',      body: '💰 *Budget Eats*\n\nWhich city or area are you in?',   children: [], intent: 'explore_budget_food' },
              ],
            },
            { id: 'local_food', title: 'Local Food', body: '🥘 *Local Food*\n\nI\'ll tell you about the best local dishes and where to find them. Which area?', children: [], intent: 'explore_local_food' },
            { id: 'delivery',   title: 'Delivery',   body: '🛵 *Food Delivery*\n\nWhich area are you in? I\'ll suggest delivery options.',                      children: [], intent: 'explore_food_delivery' },
          ],
        },
        {
          id: 'activities',
          title: 'Activities',
          body: '🎯 *Activities*\n\nWhat kind of experience are you looking for?',
          children: [
            {
              id: 'adventure',
              title: 'Adventure',
              body: '🏄 *Adventure*\n\nWhat type of adventure?',
              children: [
                { id: 'water',  title: 'Water Sports', body: '🌊 *Water Sports*\n\nWhich beach or area are you near?', children: [], intent: 'explore_water_sports' },
                { id: 'hiking', title: 'Hiking',       body: '🥾 *Hiking*\n\nWhich area or trail are you interested in?', children: [], intent: 'explore_hiking' },
                { id: 'safari', title: 'Safari',       body: '🐘 *Safari*\n\nWhich national park interests you?',        children: [], intent: 'explore_safari' },
              ],
            },
            { id: 'tours',     title: 'Tours',    body: '🧭 *Tours*\n\nWhat kind of tour? Day trip, cultural, historical?', children: [], intent: 'explore_tours' },
            { id: 'cultural',  title: 'Cultural', body: '🛕 *Cultural Experiences*\n\nWhich area or type of cultural experience?', children: [], intent: 'explore_culture' },
          ],
        },
        {
          id: 'events',
          title: 'Events & Shopping',
          body: '🎉 *Events & Shopping*\n\nWhat are you looking for?',
          children: [
            { id: 'events_list', title: 'Events',   body: '🎊 *Events*\n\nWhich city and when are you visiting?',          children: [], intent: 'explore_festivals' },
            { id: 'shopping',    title: 'Shopping', body: '🛍️ *Shopping*\n\nWhat are you looking to buy? Souvenirs, gems, clothing?', children: [], intent: 'explore_shopping' },
            { id: 'tickets',     title: 'Tickets',  body: '🎟️ *Tickets*\n\nWhat event or attraction do you need tickets for?', children: [], intent: 'book_tickets' },
          ],
        },
      ],
    },

    // ── Level 1: Stay & Essentials ───────────────────────────────────────
    {
      id: 'stay',
      title: '🧳 Stay & Essentials',
      body: '🧳 *Stay & Essentials*\n\nWhat do you need?',
      children: [
        {
          id: 'accommodation',
          title: 'Accommodation',
          body: '🏨 *Accommodation*\n\nWhat would you like to do?',
          children: [
            { id: 'book',    title: 'Book Stay',       body: '🏨 *Book a Stay*\n\nWhich city and what dates are you looking at?',    children: [], intent: 'search_hotels' },
            { id: 'manage',  title: 'Manage Booking',  body: '📋 *Manage Booking*\n\nPlease share your booking reference.',           children: [], intent: 'manage_booking' },
            { id: 'requests',title: 'Requests',        body: '🛎️ *Special Requests*\n\nWhat would you like to request for your stay?', children: [], intent: 'hotel_requests' },
          ],
        },
        {
          id: 'essentials',
          title: 'Travel Essentials',
          body: '💼 *Travel Essentials*\n\nWhat do you need help with?',
          children: [
            { id: 'sim',     title: 'SIM / Internet',  body: '📱 *SIM & Internet*\n\nI\'ll tell you the best SIM options for tourists in Sri Lanka.', children: [], intent: 'explore_sim_cards' },
            { id: 'money',   title: 'Money Exchange',  body: '💱 *Money Exchange*\n\nI\'ll help you find the best exchange rates and locations.',      children: [], intent: 'explore_money_exchange' },
            { id: 'packing', title: 'Packing Needs',   body: '🎒 *Packing Needs*\n\nWhat kind of trip are you planning? I\'ll suggest what to pack.', children: [], intent: 'explore_packing_tips' },
          ],
        },
        {
          id: 'help',
          title: 'Help & Special',
          body: '🆘 *Help & Special*\n\nHow can I assist you?',
          children: [
            {
              id: 'special',
              title: 'Special Requests',
              body: '✨ *Special Requests*\n\nWhat are you planning?',
              children: [
                { id: 'birthday', title: 'Birthday',     body: '🎂 *Birthday*\n\nTell me about the celebration — location, date, and what you have in mind!', children: [], intent: 'plan_birthday' },
                { id: 'proposal', title: 'Proposal',     body: '💍 *Proposal*\n\nHow romantic! Tell me the location and date — I\'ll help make it perfect.', children: [], intent: 'plan_proposal' },
                { id: 'custom',   title: 'Custom Plan',  body: '🗓️ *Custom Plan*\n\nTell me your dates, interests, and budget — I\'ll build a plan for you.', children: [], intent: 'plan_custom' },
              ],
            },
            { id: 'emergency', title: 'Emergency', body: '🚨 *Emergency*\n\nFor immediate emergencies call 119 (Police) or 1990 (Ambulance).\n\nHow else can I help?', children: [], intent: 'emergency_help' },
            { id: 'medical',   title: 'Medical',   body: '🏥 *Medical*\n\nI\'ll help you find the nearest hospital or clinic. Which area are you in?',             children: [], intent: 'find_medical' },
          ],
        },
      ],
    },
  ],
};

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
  // Interactive button menu methods
  // ============================================================================

  /**
   * Returns the top-level button message (Level 1 — main menu).
   * Triggered when the user sends "test".
   */
  getMainButtonMenu(): ButtonMessage {
    return this.nodeToButtonMessage(BUTTON_TREE);
  }

  /**
   * Given a ButtonPayload ID (what Twilio sends back when a button is tapped),
   * returns the next ButtonMessage to send.
   *
   * Returns null if the ID is a leaf node (no children) — the caller should
   * then set the intent and let the LLM handle the conversation.
   */
  resolveButtonPayload(buttonId: string): {
    message: ButtonMessage | null;
    intent: string | null;
    isLeaf: boolean;
  } {
    const node = this.findNodeById(BUTTON_TREE, buttonId);

    if (!node) {
      return { message: null, intent: null, isLeaf: false };
    }

    if (node.children.length === 0) {
      // Leaf node — return the body as a plain message and the intent
      return {
        message: { body: node.body, buttons: [] },
        intent: node.intent ?? null,
        isLeaf: true,
      };
    }

    return {
      message: this.nodeToButtonMessage(node),
      intent: null,
      isLeaf: false,
    };
  }

  /**
   * Converts a ButtonNode into a ButtonMessage (body + button list).
   */
  private nodeToButtonMessage(node: ButtonNode): ButtonMessage {
    return {
      body: node.body,
      // WhatsApp allows max 3 buttons — children are already capped at 3
      buttons: node.children.slice(0, 3).map((child) => ({
        id: child.id,
        title: child.title.substring(0, 20), // WhatsApp 20-char limit
      })),
    };
  }

  /**
   * Depth-first search for a node by ID.
   */
  private findNodeById(node: ButtonNode, id: string): ButtonNode | null {
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = this.findNodeById(child, id);
      if (found) return found;
    }
    return null;
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
