// VGI Agent Universe — single source of truth for all agents.
// Edit this file to add/update agents. Every page reads from window.AGENTS.

window.AGENTS = [
  {
    id: "rag-knowledge-agent",
    name: "RAG Knowledge Agent",
    bot: "@vgi_knowledge_assistant_bot",
    botName: "VGI Knowledge Assistant",
    extraBots: [
      {
        name: "VGI Drive Assistant",
        bot: "@Vgi_drive_assistant_bot"
      }
    ],
    category: "Knowledge Base",
    icon: "database",
    status: "Available",
    short:
      "Turn your PDFs, docs, and wikis into a chat interface that answers with exact citations from your sources.",
    long:
      "A retrieval-augmented chatbot built on top of your private documents. Ingests PDFs, Notion, Confluence, Google Drive, and websites; chunks and embeds them; and answers questions with citations linking back to the original source. Permissions and access controls mirror your existing folder structure.",
    features: [
      "Ingests PDF, DOCX, Notion, Confluence, web",
      "Citation-backed answers — no hallucinated facts",
      "Source-level access controls",
      "Auto re-indexing on document changes",
      "Embeddable as a widget or Slack bot"
    ],
    stack: ["Pinecone", "LlamaIndex", "GPT-4o", "Cohere Rerank", "Next.js"]
  },
  {
    id: "marketing-content-agent",
    name: "Marketing Content Agent",
    bot: "@vgi_marketing_assistant_bot",
    category: "Marketing",
    icon: "megaphone",
    status: "Available",
    short:
      "Generates on-brand social posts, blog drafts, and ad copy across channels from a single content brief.",
    long:
      "A content engine that takes one campaign brief and produces channel-specific variants for LinkedIn, Instagram, X, blog, and email. Trained on your past best-performing posts to stay on-voice. Includes a calendar view and a one-click publish to Buffer or Meta Business Suite.",
    features: [
      "Brief → multi-channel variants in one click",
      "Trained on your top-performing past posts",
      "Built-in calendar and scheduling",
      "Image prompt generation for cover art",
      "A/B headline scoring before you publish"
    ],
    stack: ["Claude 3.5", "GPT-4o", "Buffer API", "DALL·E 3", "Next.js"]
  },
  {
    id: "stock-market-agent",
    name: "Stock Market Agent",
    bot: "@vgi_portfolio_assistant_bot",
    category: "Finance",
    icon: "line-chart",
    status: "Available",
    short:
      "Watches your portfolio, news, and technical signals to surface daily insights and unusual-move alerts.",
    long:
      "Connects to your broker (read-only) and runs a daily check on your holdings against fundamentals, news, and technical indicators. Sends alerts on unusual price action, earnings dates, and material news. This is research support — not financial advice — and every signal links to source data.",
    features: [
      "Read-only broker integration (Zerodha, IBKR)",
      "Daily morning watchlist briefing",
      "Earnings + dividend calendar reminders",
      "News + filing summarisation per holding",
      "Unusual volume + price-move alerts"
    ],
    stack: ["yfinance", "Alpaca API", "GPT-4o", "TA-Lib", "Postgres"]
  },
  {
    id: "hr-recruitment-agent",
    name: "HR Recruitment Agent",
    bot: "@vgi_resume_assistant_bot",
    category: "HR",
    icon: "users",
    status: "Available",
    short:
      "Screens incoming CVs against your JD, shortlists the top 10, and schedules screening calls automatically.",
    long:
      "Connects to your careers inbox or ATS, parses every incoming CV, scores it against the role's must-haves and nice-to-haves, and surfaces the top candidates with a reasoning trail. Can run a first-pass async video screen via a chat link and post results to your hiring manager.",
    features: [
      "CV parsing + JD-fit scoring with rationale",
      "Async first-round screening via chat link",
      "Calendar-aware scheduling for next round",
      "Bias-audit report on shortlists",
      "Greenhouse / Lever / Zoho ATS integration"
    ],
    stack: ["OpenAI Whisper", "GPT-4o", "Greenhouse API", "Cal.com", "Postgres"]
  },
  {
    id: "customer-review-responder",
    name: "Customer Review Responder",
    bot: "@vgi_reviews_assistant_bot",
    category: "Reputation Management",
    icon: "star",
    status: "Available",
    short:
      "Drafts on-brand replies to Google, Yelp, and Amazon reviews — every reply approved by you before posting.",
    long:
      "Monitors your reviews across Google Business, Yelp, Amazon, and the App Stores. Drafts a reply within 30 minutes of each new review — empathetic for negative, warm for positive, on-brand always. You approve from a single inbox; the agent posts via official APIs.",
    features: [
      "Real-time review monitoring across platforms",
      "Tone-matched reply drafts for every review",
      "Single approval inbox with mobile push",
      "Sentiment + theme reporting",
      "Escalation rules for critical reviews"
    ],
    stack: ["Google Business API", "Yelp Fusion", "Claude 3.5", "Slack", "Next.js"]
  },
  {
    id: "appointment-booking-agent",
    name: "Appointment Booking Agent",
    bot: "@vgi_booking_assistant_bot",
    category: "Service Business",
    icon: "calendar",
    status: "Available",
    short:
      "Books, reschedules, and reminds — across WhatsApp, voice, and web — synced to your team's calendars.",
    long:
      "A booking agent purpose-built for salons, clinics, and service businesses. Customers book by WhatsApp message, voice call, or website widget. The agent checks staff availability, holds the slot, sends reminders, handles reschedules, and collects payment up-front if you want it to.",
    features: [
      "WhatsApp + voice + web widget booking",
      "Multi-staff, multi-location calendar logic",
      "Automated reminders + waitlist promotion",
      "Optional pre-payment via Razorpay / Stripe",
      "No-show tracking and follow-up flows"
    ],
    stack: ["Twilio Voice", "WhatsApp API", "Cal.com", "Razorpay", "Postgres"]
  },
  {
    id: "whatsapp-ai-assistant",
    name: "WhatsApp AI Assistant",
    bot: "@vgi_whatsapp_assistant_bot",
    category: "Customer Support",
    icon: "message-circle",
    status: "Coming Soon",
    short:
      "24/7 conversational AI on WhatsApp that handles enquiries, qualifies leads, and books appointments in your tone.",
    long:
      "An always-on WhatsApp agent that plugs into the WhatsApp Business API to handle inbound customer conversations end-to-end. It understands intent, replies in your brand voice across multiple languages, captures structured lead data, and hands off to a human the moment a conversation needs one. Comes with conversation analytics so you can see what your customers actually ask for.",
    features: [
      "Multilingual replies tuned to your brand voice",
      "Lead capture with structured fields pushed to your CRM",
      "Human handoff with full conversation context",
      "Appointment + reminder flows out of the box",
      "Conversation analytics & intent reports"
    ],
    stack: ["WhatsApp Cloud API", "GPT-4o", "LangChain", "Pinecone", "Node.js"]
  },
  {
    id: "vision-ai-agent",
    name: "Vision AI Agent",
    bot: "@vgi_vision_bot",
    category: "Computer Vision",
    icon: "eye",
    status: "Coming Soon",
    short:
      "Detects, classifies, and counts objects in images and video — for QC, retail shelf audits, and security.",
    long:
      "A computer-vision agent that runs on CCTV feeds, uploaded images, or live phone camera. Trained for the use-case you care about — defect detection on a production line, shelf gap analysis in retail, PPE compliance on a site. Returns structured JSON plus annotated frames for review.",
    features: [
      "Custom object detection in 48 hours",
      "Runs on edge devices or cloud GPU",
      "Annotated output frames + structured JSON",
      "Real-time alerts via webhook or WhatsApp",
      "Privacy-first: deploys on your infra if needed"
    ],
    stack: ["YOLOv8", "OpenCV", "PyTorch", "ONNX", "NVIDIA Jetson"]
  },
  {
    id: "ecommerce-price-monitor",
    name: "E-Commerce Price Monitor",
    bot: "@vgi_price_monitor_bot",
    category: "Business Intelligence",
    icon: "tag",
    status: "Coming Soon",
    short:
      "Tracks competitor prices across Amazon, Flipkart, and DTC sites and flags when to reprice your SKUs.",
    long:
      "Watches your SKUs across every marketplace and competitor DTC site you care about. Detects price drops, stock-outs, and promotions in near-real-time. Recommends repricing actions based on your margin floor and elasticity history. Plays nicely with Shopify and the Amazon Seller API.",
    features: [
      "SKU-level tracking across Amazon, Flipkart, DTC",
      "Stock-out + promotion detection",
      "Margin-aware repricing recommendations",
      "Daily delta reports per category",
      "Shopify + Amazon Seller Central push"
    ],
    stack: ["Playwright", "BrightData", "Postgres", "Shopify API", "FastAPI"]
  },
  {
    id: "youtube-seo-research-agent",
    name: "YouTube SEO Research Agent",
    bot: "@vgi_youtube_seo_bot",
    category: "Content Creation",
    icon: "youtube",
    status: "Coming Soon",
    short:
      "Finds keyword gaps in your niche, suggests video topics, and writes optimised titles, tags, and descriptions.",
    long:
      "Plug in your channel and the agent reverse-engineers the search and recommendation patterns in your niche. It surfaces under-served keywords, suggests video topics ranked by traffic potential vs effort, and writes the title, description, tags, and chapter markers — all tuned to your channel's existing voice.",
    features: [
      "Keyword-gap analysis against top channels",
      "Topic ideation ranked by opportunity score",
      "Title + description + tags generation",
      "Auto chapter markers from your script",
      "Thumbnail concept prompts"
    ],
    stack: ["YouTube Data API", "GPT-4o", "VidIQ data", "Python", "Supabase"]
  }
];

window.UNIVERSE_BOT = "@vgiskilluniversebot";

window.CATEGORIES = [
  "All",
  ...Array.from(new Set(window.AGENTS.map((a) => a.category)))
];
