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
    stack: ["Pinecone", "LlamaIndex", "GPT-4o", "Cohere Rerank", "Next.js"],
    howItWorks: {
      inputs: [
        "<strong>Ingestion Sources:</strong> PDF, DOCX, Notion, or Google Drive folder sync.",
        "<strong>Query text:</strong> Question from user.",
        "<strong>Access tokens:</strong> Google Drive or Confluence permissions."
      ],
      outputs: [
        "<strong>Answer:</strong> Synthesis based strictly on reference context.",
        "<strong>Citations:</strong> Filename, page number, and source URL reference.",
        "<strong>Confidence Score:</strong> Retrieval similarity value."
      ],
      useSteps: [
        "Connect your document sources in your dashboard panel.",
        "Wait for the vector indexing engine to chunk and embed files.",
        "Ask questions directly in the web chat widget, Slack, or Telegram."
      ],
      pipeline: [
        "Document Upload",
        "Embedding & Vector Store",
        "Similarity Search",
        "LLM Citation Synthesis"
      ]
    }
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
    stack: ["Claude 3.5", "GPT-4o", "Buffer API", "DALL·E 3", "Next.js"],
    howItWorks: {
      inputs: [
        "<strong>Campaign brief:</strong> Subject topic, core messaging points.",
        "<strong>Target Channels:</strong> LinkedIn, Instagram, X (Twitter), Blog, or Email.",
        "<strong>Brand Tone:</strong> Past top-performing posts style."
      ],
      outputs: [
        "<strong>Draft variants:</strong> Multi-channel formatted text variants.",
        "<strong>Visual assets:</strong> DALL·E 3 generated cover image concept prompts.",
        "<strong>Republish Queue:</strong> Direct sync to Buffer/Meta calendar slots."
      ],
      useSteps: [
        "Input your campaign brief details and select target outputs.",
        "Click \"Generate\" and review the draft variations in your editor.",
        "Edit or click \"Publish\" to schedule the posts onto your channels."
      ],
      pipeline: [
        "Brief Submission",
        "Channel Adaptation",
        "Brand Verification",
        "Schedule / Publish"
      ]
    }
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
    stack: ["yfinance", "Alpaca API", "GPT-4o", "TA-Lib", "Postgres"],
    howItWorks: {
      inputs: [
        "<strong>Broker linkage:</strong> Read-only broker API or CSV upload.",
        "<strong>Watchlist symbols:</strong> Specific stock tickers.",
        "<strong>Alert thresholds:</strong> Price/Volume change triggers."
      ],
      outputs: [
        "<strong>Morning Briefing:</strong> Summary watchlist reports before market open.",
        "<strong>Real-time alerts:</strong> Slack, Webhook, or Telegram text notifications.",
        "<strong>Source documentation:</strong> Direct links to financial reports or filings."
      ],
      useSteps: [
        "Link your brokerage account securely using read-only API access.",
        "Define triggers for stock watchlists.",
        "Configure notifications to hit your workspace channel (Slack/Telegram)."
      ],
      pipeline: [
        "Portfolio Synchronization",
        "TA & News Crawling",
        "Signal Analysis",
        "Alert Dispatch"
      ]
    }
  },
  {
    id: "hr-recruitment-agent",
    name: "HR Recruitment Agent",
    bot: "@vgi_resume_assistant_bot",
    botName: "VGI Resume Analyzer",
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
    stack: ["OpenAI Whisper", "GPT-4o", "Greenhouse API", "Cal.com", "Postgres"],
    howItWorks: {
      inputs: [
        "<strong>Job Description:</strong> Active role must-haves and criteria.",
        "<strong>CV files:</strong> PDF resume uploads from applicants.",
        "<strong>Hiring Slots:</strong> Recruiter calendar availability."
      ],
      outputs: [
        "<strong>Scorecards:</strong> Structured fit score and evaluation trails.",
        "<strong>Shortlists:</strong> Top candidates flagged for interview.",
        "<strong>Scheduled slots:</strong> Live calendar invites via Cal.com."
      ],
      useSteps: [
        "Upload job requirements and criteria guidelines.",
        "Connect application pipelines (email inbox or ATS integrations).",
        "Review scores on the candidate board and confirm calendar bookings."
      ],
      pipeline: [
        "CV Parsing",
        "Must-Haves Scoring",
        "Fit Evaluation",
        "Calendar Scheduling"
      ]
    }
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
    stack: ["Google Business API", "Yelp Fusion", "Claude 3.5", "Slack", "Next.js"],
    howItWorks: {
      inputs: [
        "<strong>Listing Sync:</strong> Google Business, Yelp, or Amazon seller API.",
        "<strong>Guidelines:</strong> Brand voice guidelines, response policies.",
        "<strong>Customer reviews:</strong> Newly received review stars and text."
      ],
      outputs: [
        "<strong>Draft responses:</strong> Tone-aligned answers ready for publish.",
        "<strong>Alert triggers:</strong> Notifications for negative review reviewals.",
        "<strong>Sentiment metrics:</strong> Performance feedback statistics."
      ],
      useSteps: [
        "Link Google, Yelp, or Amazon listings to active reviewer agents.",
        "Review incoming draft responses in your central approval feed.",
        "Click \"Approve\" to post response to customer listings via APIs."
      ],
      pipeline: [
        "Review Monitoring",
        "Sentiment Analysis",
        "Drafting Response",
        "Approved Publish"
      ]
    }
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
    stack: ["Twilio Voice", "WhatsApp API", "Cal.com", "Razorpay", "Postgres"],
    howItWorks: {
      inputs: [
        "<strong>Staff slots:</strong> Live availability synced to team calendars.",
        "<strong>Customer detail:</strong> Name, contact details, requested service.",
        "<strong>Payment details:</strong> Razorpay / Stripe billing credentials."
      ],
      outputs: [
        "<strong>Calendar entries:</strong> Synced event reservations in team schedules.",
        "<strong>Reminders:</strong> Automated WhatsApp reminder notifications.",
        "<strong>Bills:</strong> Payment confirmations and structured receipts."
      ],
      useSteps: [
        "Connect team calendar feeds and define operational slots.",
        "Embed booking widgets on web pages or deploy to WhatsApp numbers.",
        "Monitor active schedules and review reminders through calendars."
      ],
      pipeline: [
        "Booking Query",
        "Availability Verification",
        "Payment Processing",
        "Calendar Reservation"
      ]
    }
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
    stack: ["WhatsApp Cloud API", "GPT-4o", "LangChain", "Pinecone", "Node.js"],
    howItWorks: {
      inputs: [
        "<strong>Channel Credentials:</strong> WhatsApp Business API access tokens.",
        "<strong>Knowledge Docs:</strong> Product lists, FAQs, and support guidelines.",
        "<strong>Lead Schema:</strong> Fields to collect (e.g. email, phone, requirements)."
      ],
      outputs: [
        "<strong>Automated Replies:</strong> Conversational answers in brand tone.",
        "<strong>Pushed Leads:</strong> Structured lead profiles synced directly to your CRM.",
        "<strong>Handoff Alerts:</strong> Slack/Email notification when human intervention is needed."
      ],
      useSteps: [
        "Configure your WhatsApp Business API and hook it to the platform.",
        "Upload FAQ documents and set up lead capture criteria.",
        "Let the agent handle inbound messages and review human handoffs."
      ],
      pipeline: [
        "Inbound Message",
        "Intent Classification",
        "CRM Context Lookup",
        "Auto-Response / Handoff"
      ]
    }
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
    stack: ["YOLOv8", "OpenCV", "PyTorch", "ONNX", "NVIDIA Jetson"],
    howItWorks: {
      inputs: [
        "<strong>Video Feed:</strong> RTSP CCTV streams or folder of uploaded images.",
        "<strong>Detection Classes:</strong> Specific objects to count or inspect (e.g., defects, boxes, masks).",
        "<strong>Alert Thresholds:</strong> Confidence score filters and trigger frequencies."
      ],
      outputs: [
        "<strong>Annotated Frames:</strong> Video clips or photos with highlighted detection boxes.",
        "<strong>Detection Logs:</strong> Structured JSON payloads of counts, times, and labels.",
        "<strong>Incident Alerts:</strong> Immediate Telegram or Webhook pings on critical violations."
      ],
      useSteps: [
        "Register your video camera streams or batch folders.",
        "Define object detection classes and regions of interest.",
        "Receive alerts and review detection reports in your analytics dashboard."
      ],
      pipeline: [
        "Frame Acquisition",
        "Object Detection (YOLOv8)",
        "Coordinate Filtering",
        "Alert Notification"
      ]
    }
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
    stack: ["Playwright", "BrightData", "Postgres", "Shopify API", "FastAPI"],
    howItWorks: {
      inputs: [
        "<strong>Your Catalog:</strong> List of product SKUs with margin floors and target pricing rules.",
        "<strong>Competitor URLs:</strong> Product pages on Amazon, Flipkart, or DTC websites.",
        "<strong>Scan Frequency:</strong> Scheduled intervals for monitoring competitor adjustments."
      ],
      outputs: [
        "<strong>Price Alerts:</strong> Real-time push reports when a competitor shifts their price.",
        "<strong>Repricing Suggestions:</strong> Recommended margin-safe adjustments for your store.",
        "<strong>Market Summary:</strong> Daily analysis of pricing trends and stock-out alerts."
      ],
      useSteps: [
        "Connect your Shopify or WooCommerce store securely.",
        "Input product SKUs, margin floors, and competitor page links.",
        "Review repricing suggestions and apply updates with a single click."
      ],
      pipeline: [
        "Competitor Scrape (Playwright)",
        "Price Extraction",
        "Margin Check",
        "Repricing Hook"
      ]
    }
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
    stack: ["YouTube Data API", "GPT-4o", "VidIQ data", "Python", "Supabase"],
    howItWorks: {
      inputs: [
        "<strong>Channel link:</strong> Read-only YouTube Data API access.",
        "<strong>Target Keywords:</strong> Primary search topics or competitor channel URLs.",
        "<strong>Draft Script/Video:</strong> Raw text script or video draft file."
      ],
      outputs: [
        "<strong>Optimized Metadata:</strong> Tailored titles, description drafts, and tags.",
        "<strong>Chapter Timestamps:</strong> Structured timestamp markers for the timeline.",
        "<strong>Keyword Gap Reports:</strong> Analysis showing high-traffic, low-competition keywords."
      ],
      useSteps: [
        "Link your YouTube channel and enter search phrases in the dashboard.",
        "Upload your draft script to generate structured descriptions and chapter markers.",
        "Copy-paste optimized metadata into YouTube Studio before publishing."
      ],
      pipeline: [
        "Channel Analysis",
        "Keyword Research",
        "Metadata Synthesis",
        "Output Optimization"
      ]
    }
  }
];

window.UNIVERSE_BOT = "@vgiskilluniversebot";

window.CATEGORIES = [
  "All",
  ...Array.from(new Set(window.AGENTS.map((a) => a.category)))
];
