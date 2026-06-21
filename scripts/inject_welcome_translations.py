"""Inject welcome-screen translations into all 26 fall-back locales so that
switching language actually translates the hero, USPs, CTA, etc.

We keep existing `auth` block intact (sign_in, password, etc.) and just
append the 11 welcome_* keys. Country/brand names stay in their native
spellings; placeholders like \\n are preserved.
"""
from pathlib import Path
import re

ROOT = Path("/app/frontend/src/i18n/locales")

# 26 locales × 11 keys = 286 hand-tuned strings
T = {
    "es": {  # Spanish (Castilian)
        "eyebrow": "INDIA → NUEVA ZELANDA",
        "cta": "Empezar con correo",
        "continue_signin": "¿Ya compras con nosotros?",
        "hero_title": "India auténtica,\\nentregada a tu puerta.",
        "hero_subtitle": "Compra en India como los indios — sin el viaje.",
        "usp_sellers": "Directo de vendedores indios",
        "usp_shipping": "Envío a NZ en 7-14 días",
        "usp_payments": "Pagos seguros en NZD",
        "or": "o",
        "continue_google": "Continuar con Google",
        "sign_in": "Iniciar sesión",
    },
    "ar": {  # Arabic
        "eyebrow": "الهند ← نيوزيلندا",
        "cta": "ابدأ بالبريد الإلكتروني",
        "continue_signin": "هل تتسوق معنا بالفعل؟",
        "hero_title": "الهند الأصيلة،\\nتُوصَّل إلى بابك.",
        "hero_subtitle": "تسوّق في الهند كما يفعل الهنود — بدون السفر.",
        "usp_sellers": "مباشرة من البائعين الهنود",
        "usp_shipping": "الشحن إلى نيوزيلندا خلال 7-14 يومًا",
        "usp_payments": "مدفوعات آمنة بالدولار النيوزيلندي",
        "or": "أو",
        "continue_google": "متابعة باستخدام Google",
        "sign_in": "تسجيل الدخول",
    },
    "zh": {  # Simplified Chinese
        "eyebrow": "印度 → 新西兰",
        "cta": "使用邮箱开始",
        "continue_signin": "已经是用户了？",
        "hero_title": "正宗印度商品，\\n直送到家。",
        "hero_subtitle": "像印度人一样在印度购物——无需出行。",
        "usp_sellers": "直接来自印度卖家",
        "usp_shipping": "7-14 天送达新西兰",
        "usp_payments": "新西兰元安全支付",
        "or": "或",
        "continue_google": "使用 Google 继续",
        "sign_in": "登录",
    },
    "zh-TW": {  # Traditional Chinese
        "eyebrow": "印度 → 紐西蘭",
        "cta": "使用電子郵件開始",
        "continue_signin": "已經是會員了嗎？",
        "hero_title": "道地印度商品，\\n直送到府。",
        "hero_subtitle": "像印度人一樣在印度購物——無需出行。",
        "usp_sellers": "直接來自印度賣家",
        "usp_shipping": "7-14 天送達紐西蘭",
        "usp_payments": "紐元安全支付",
        "or": "或",
        "continue_google": "使用 Google 繼續",
        "sign_in": "登入",
    },
    "pt": {  # Portuguese (Brazilian)
        "eyebrow": "ÍNDIA → NOVA ZELÂNDIA",
        "cta": "Começar com e-mail",
        "continue_signin": "Já compra com a gente?",
        "hero_title": "Índia autêntica,\\nentregue na sua porta.",
        "hero_subtitle": "Compre na Índia como os indianos — sem precisar viajar.",
        "usp_sellers": "Direto de vendedores indianos",
        "usp_shipping": "Envio para NZ em 7-14 dias",
        "usp_payments": "Pagamentos seguros em NZD",
        "or": "ou",
        "continue_google": "Continuar com Google",
        "sign_in": "Entrar",
    },
    "fr": {  # French
        "eyebrow": "INDE → NOUVELLE-ZÉLANDE",
        "cta": "Commencer avec un e-mail",
        "continue_signin": "Déjà client chez nous ?",
        "hero_title": "L'Inde authentique,\\nlivrée à votre porte.",
        "hero_subtitle": "Achetez en Inde comme les Indiens — sans le voyage.",
        "usp_sellers": "Directement de vendeurs indiens",
        "usp_shipping": "Livraison en NZ en 7-14 jours",
        "usp_payments": "Paiements sécurisés en NZD",
        "or": "ou",
        "continue_google": "Continuer avec Google",
        "sign_in": "Se connecter",
    },
    "de": {  # German
        "eyebrow": "INDIEN → NEUSEELAND",
        "cta": "Mit E-Mail starten",
        "continue_signin": "Schon Kunde bei uns?",
        "hero_title": "Authentisches Indien,\\nan deine Tür geliefert.",
        "hero_subtitle": "Kaufe in Indien ein, wie Inder es tun — ohne die Reise.",
        "usp_sellers": "Direkt von indischen Verkäufern",
        "usp_shipping": "Versand nach NZ in 7-14 Tagen",
        "usp_payments": "Sichere Zahlungen in NZD",
        "or": "oder",
        "continue_google": "Mit Google fortfahren",
        "sign_in": "Anmelden",
    },
    "ja": {  # Japanese
        "eyebrow": "インド → ニュージーランド",
        "cta": "メールで始める",
        "continue_signin": "すでにご利用ですか？",
        "hero_title": "本場のインドを、\\nご自宅までお届け。",
        "hero_subtitle": "インドの人々と同じように、旅行せずにインドで買い物。",
        "usp_sellers": "インドの売り手から直接",
        "usp_shipping": "NZへ7〜14日で発送",
        "usp_payments": "NZDで安全な決済",
        "or": "または",
        "continue_google": "Googleで続ける",
        "sign_in": "サインイン",
    },
    "ko": {  # Korean
        "eyebrow": "인도 → 뉴질랜드",
        "cta": "이메일로 시작",
        "continue_signin": "이미 회원이신가요?",
        "hero_title": "정통 인도 상품을,\\n문 앞까지 배송.",
        "hero_subtitle": "여행 없이, 인도인처럼 인도에서 쇼핑하세요.",
        "usp_sellers": "인도 셀러로부터 직접",
        "usp_shipping": "뉴질랜드까지 7-14일 배송",
        "usp_payments": "NZD로 안전한 결제",
        "or": "또는",
        "continue_google": "Google로 계속하기",
        "sign_in": "로그인",
    },
    "bn": {  # Bengali
        "eyebrow": "ভারত → নিউজিল্যান্ড",
        "cta": "ইমেল দিয়ে শুরু করুন",
        "continue_signin": "ইতিমধ্যে আমাদের কাছ থেকে কেনাকাটা করছেন?",
        "hero_title": "আসল ভারত,\\nআপনার দরজায় পৌঁছে দেওয়া।",
        "hero_subtitle": "ভ্রমণ ছাড়াই, ভারতীয়দের মতো ভারতে কেনাকাটা করুন।",
        "usp_sellers": "সরাসরি ভারতীয় বিক্রেতার কাছ থেকে",
        "usp_shipping": "NZ-এ 7-14 দিনে শিপিং",
        "usp_payments": "NZD-তে নিরাপদ পেমেন্ট",
        "or": "অথবা",
        "continue_google": "Google দিয়ে চালিয়ে যান",
        "sign_in": "সাইন ইন",
    },
    "ta": {  # Tamil
        "eyebrow": "இந்தியா → நியூசிலாந்து",
        "cta": "மின்னஞ்சலுடன் தொடங்கவும்",
        "continue_signin": "ஏற்கனவே எங்களுடன் வாங்குகிறீர்களா?",
        "hero_title": "உண்மையான இந்தியா,\\nஉங்கள் வீட்டிற்கு வழங்கப்படுகிறது.",
        "hero_subtitle": "பயணம் இல்லாமல், இந்தியர்களைப் போல் இந்தியாவில் கடைப்பிடியுங்கள்.",
        "usp_sellers": "இந்திய விற்பனையாளர்களிடமிருந்து நேரடியாக",
        "usp_shipping": "NZ-க்கு 7-14 நாட்களில் கப்பல்",
        "usp_payments": "NZD-இல் பாதுகாப்பான கட்டணம்",
        "or": "அல்லது",
        "continue_google": "Google உடன் தொடரவும்",
        "sign_in": "உள்நுழைய",
    },
    "id": {  # Indonesian
        "eyebrow": "INDIA → SELANDIA BARU",
        "cta": "Mulai dengan email",
        "continue_signin": "Sudah berbelanja bersama kami?",
        "hero_title": "India autentik,\\ndiantar ke pintu Anda.",
        "hero_subtitle": "Belanja di India seperti orang India — tanpa perjalanan.",
        "usp_sellers": "Langsung dari penjual India",
        "usp_shipping": "Pengiriman ke NZ dalam 7-14 hari",
        "usp_payments": "Pembayaran aman dalam NZD",
        "or": "atau",
        "continue_google": "Lanjutkan dengan Google",
        "sign_in": "Masuk",
    },
    "ru": {  # Russian
        "eyebrow": "ИНДИЯ → НОВАЯ ЗЕЛАНДИЯ",
        "cta": "Начать с электронной почты",
        "continue_signin": "Уже наш клиент?",
        "hero_title": "Подлинная Индия,\\nпрямо к вашей двери.",
        "hero_subtitle": "Покупайте в Индии как индийцы — без поездок.",
        "usp_sellers": "Напрямую от индийских продавцов",
        "usp_shipping": "Доставка в НЗ за 7-14 дней",
        "usp_payments": "Безопасные платежи в NZD",
        "or": "или",
        "continue_google": "Продолжить через Google",
        "sign_in": "Войти",
    },
    "mi": {  # Māori
        "eyebrow": "ĪNIA → AOTEAROA",
        "cta": "Tīmata ki te īmēra",
        "continue_signin": "E hokohoko mai ana koe ki a mātou?",
        "hero_title": "Ngā taonga tūturu o Īnia,\\nka tukuna ki tō tatau.",
        "hero_subtitle": "Hokohoko ki Īnia, pēnei i ngā tāngata o Īnia — kāore he haere.",
        "usp_sellers": "Mai i ngā kaihoko o Īnia tonu",
        "usp_shipping": "Tukuna ki Aotearoa i roto i ngā rā 7-14",
        "usp_payments": "Utu haumaru ki te NZD",
        "or": "rānei",
        "continue_google": "Haere tonu ki Google",
        "sign_in": "Takiuru",
    },
    "sm": {  # Samoan
        "eyebrow": "INITIA → NIU SILA",
        "cta": "Amata i le imeli",
        "continue_signin": "E te faatauina mea i a matou?",
        "hero_title": "Initia moni,\\ne tuuina atu i lou faitotoa.",
        "hero_subtitle": "Faatau i Initia e pei o tagata Initia — e leai se malaga.",
        "usp_sellers": "Saʻo mai tagata faatau Initia",
        "usp_shipping": "Auina atu i Niu Sila i le 7-14 aso",
        "usp_payments": "Totogi saogalemu i le NZD",
        "or": "po o",
        "continue_google": "Faaauau ma Google",
        "sign_in": "Saini i totonu",
    },
    "to": {  # Tongan
        "eyebrow": "ʻINITIA → NUʻU SILA",
        "cta": "Kamata ʻaki e ʻimeili",
        "continue_signin": "ʻOku ke fakatauʻaki mai kiate kimautolu?",
        "hero_title": "ʻInitia moʻoni,\\nʻoku ʻomi ki ho matapā.",
        "hero_subtitle": "Fakatau ʻi ʻInitia hangē ko e kakai ʻInitia — taʻe ha fononga.",
        "usp_sellers": "Hangatonu mei he kau fakatau ʻInitia",
        "usp_shipping": "Fakaholo ki NZ ʻi he ʻaho 7-14",
        "usp_payments": "Totongi malu ʻi he NZD",
        "or": "pe",
        "continue_google": "Hokohoko mo Google",
        "sign_in": "Hū ki loto",
    },
    "fj": {  # Fijian
        "eyebrow": "INIDIA → VITI NIUSILADI",
        "cta": "Tekivu ena imeli",
        "continue_signin": "Ko ni sa volia tiko mai?",
        "hero_title": "Inidia dina,\\nsoli ki na nomu katuba.",
        "hero_subtitle": "Volivolitaki ena Inidia, vaka era cakava na kai Idia — sega ni vodo.",
        "usp_sellers": "Sa donumaki mai vei ira na dauvolitaki ena Inidia",
        "usp_shipping": "Vakaroti ki NZ ena 7-14 na siga",
        "usp_payments": "Saumi taudaku ena NZD",
        "or": "se",
        "continue_google": "Tomana kei Google",
        "sign_in": "Curu i loma",
    },
    "te": {  # Telugu
        "eyebrow": "భారతదేశం → న్యూజిలాండ్",
        "cta": "ఇమెయిల్‌తో ప్రారంభించండి",
        "continue_signin": "ఇప్పటికే మాతో షాపింగ్ చేస్తున్నారా?",
        "hero_title": "నిజమైన భారత్,\\nమీ ఇంటి వద్దకే.",
        "hero_subtitle": "ప్రయాణం లేకుండా, భారతీయుల్లా భారత్‌లో షాపింగ్ చేయండి.",
        "usp_sellers": "భారతీయ విక్రేతల నుండి నేరుగా",
        "usp_shipping": "NZకి 7-14 రోజుల్లో షిప్పింగ్",
        "usp_payments": "NZDలో సురక్షిత చెల్లింపులు",
        "or": "లేదా",
        "continue_google": "Googleతో కొనసాగించండి",
        "sign_in": "సైన్ ఇన్",
    },
    "mr": {  # Marathi
        "eyebrow": "भारत → न्यूझीलंड",
        "cta": "ईमेलने सुरुवात करा",
        "continue_signin": "आधीच आमच्याकडे खरेदी करत आहात?",
        "hero_title": "खरा भारत,\\nतुमच्या दारी पोचवला.",
        "hero_subtitle": "प्रवास न करता, भारतीयांप्रमाणे भारतात खरेदी करा.",
        "usp_sellers": "थेट भारतीय विक्रेत्यांकडून",
        "usp_shipping": "NZ ला 7-14 दिवसांत शिपिंग",
        "usp_payments": "NZD मध्ये सुरक्षित पेमेंट",
        "or": "किंवा",
        "continue_google": "Google सह सुरू ठेवा",
        "sign_in": "साइन इन",
    },
    "ur": {  # Urdu
        "eyebrow": "بھارت ← نیوزی لینڈ",
        "cta": "ای میل سے شروع کریں",
        "continue_signin": "پہلے سے ہمارے ساتھ خریداری کر رہے ہیں؟",
        "hero_title": "اصلی بھارت،\\nآپ کے دروازے تک۔",
        "hero_subtitle": "بنا سفر کے، بھارتیوں کی طرح بھارت میں خریداری کریں۔",
        "usp_sellers": "بھارتی فروخت کنندگان سے براہ راست",
        "usp_shipping": "NZ تک 7-14 دنوں میں شپنگ",
        "usp_payments": "NZD میں محفوظ ادائیگیاں",
        "or": "یا",
        "continue_google": "Google کے ساتھ جاری رکھیں",
        "sign_in": "سائن ان",
    },
    "gu": {  # Gujarati
        "eyebrow": "ભારત → ન્યુઝીલેન્ડ",
        "cta": "ઇમેઇલથી શરૂ કરો",
        "continue_signin": "પહેલેથી અમારી પાસેથી ખરીદી કરો છો?",
        "hero_title": "અસલી ભારત,\\nતમારા દરવાજે પહોંચાડ્યો.",
        "hero_subtitle": "મુસાફરી વગર, ભારતીયોની જેમ ભારતમાં ખરીદી કરો.",
        "usp_sellers": "સીધા ભારતીય વેચાણકારો પાસેથી",
        "usp_shipping": "NZ સુધી 7-14 દિવસમાં શિપિંગ",
        "usp_payments": "NZDમાં સુરક્ષિત ચૂકવણી",
        "or": "અથવા",
        "continue_google": "Google સાથે ચાલુ રાખો",
        "sign_in": "સાઇન ઇન",
    },
    "kn": {  # Kannada
        "eyebrow": "ಭಾರತ → ನ್ಯೂಜಿಲೆಂಡ್",
        "cta": "ಇಮೇಲ್‌ನೊಂದಿಗೆ ಪ್ರಾರಂಭಿಸಿ",
        "continue_signin": "ಈಗಾಗಲೇ ನಮ್ಮೊಂದಿಗೆ ಶಾಪಿಂಗ್ ಮಾಡುತ್ತಿದ್ದೀರಾ?",
        "hero_title": "ನಿಜವಾದ ಭಾರತ,\\nನಿಮ್ಮ ಬಾಗಿಲಿಗೆ ತಲುಪಿಸಲಾಗಿದೆ.",
        "hero_subtitle": "ಪ್ರಯಾಣವಿಲ್ಲದೆ, ಭಾರತೀಯರಂತೆ ಭಾರತದಲ್ಲಿ ಶಾಪಿಂಗ್ ಮಾಡಿ.",
        "usp_sellers": "ಭಾರತೀಯ ಮಾರಾಟಗಾರರಿಂದ ನೇರವಾಗಿ",
        "usp_shipping": "NZಗೆ 7-14 ದಿನಗಳಲ್ಲಿ ಶಿಪ್ಪಿಂಗ್",
        "usp_payments": "NZDನಲ್ಲಿ ಸುರಕ್ಷಿತ ಪಾವತಿಗಳು",
        "or": "ಅಥವಾ",
        "continue_google": "Googleನೊಂದಿಗೆ ಮುಂದುವರಿಸಿ",
        "sign_in": "ಸೈನ್ ಇನ್",
    },
    "ml": {  # Malayalam
        "eyebrow": "ഇന്ത്യ → ന്യൂസിലൻഡ്",
        "cta": "ഇമെയിലിലൂടെ ആരംഭിക്കുക",
        "continue_signin": "ഇതിനോടകം ഞങ്ങളോടൊപ്പം ഷോപ്പിംഗ് നടത്തുന്നുണ്ടോ?",
        "hero_title": "യഥാർത്ഥ ഇന്ത്യ,\\nനിങ്ങളുടെ വാതിൽപ്പടിയിൽ.",
        "hero_subtitle": "യാത്രയില്ലാതെ, ഇന്ത്യക്കാരെപ്പോലെ ഇന്ത്യയിൽ ഷോപ്പിംഗ് നടത്തുക.",
        "usp_sellers": "ഇന്ത്യൻ വിൽപ്പനക്കാരിൽ നിന്നും നേരിട്ട്",
        "usp_shipping": "NZ-ലേക്ക് 7-14 ദിവസത്തിനുള്ളിൽ ഷിപ്പിംഗ്",
        "usp_payments": "NZD-യിൽ സുരക്ഷിത പേയ്മെന്റുകൾ",
        "or": "അല്ലെങ്കിൽ",
        "continue_google": "Google ഉപയോഗിച്ച് തുടരുക",
        "sign_in": "സൈൻ ഇൻ",
    },
    "pa": {  # Punjabi (Gurmukhi)
        "eyebrow": "ਭਾਰਤ → ਨਿਊਜ਼ੀਲੈਂਡ",
        "cta": "ਈਮੇਲ ਨਾਲ ਸ਼ੁਰੂ ਕਰੋ",
        "continue_signin": "ਪਹਿਲਾਂ ਹੀ ਸਾਡੇ ਨਾਲ ਖਰੀਦਦਾਰੀ ਕਰ ਰਹੇ ਹੋ?",
        "hero_title": "ਅਸਲੀ ਭਾਰਤ,\\nਤੁਹਾਡੇ ਦਰਵਾਜ਼ੇ ਤੇ.",
        "hero_subtitle": "ਯਾਤਰਾ ਤੋਂ ਬਿਨਾਂ, ਭਾਰਤੀਆਂ ਵਾਂਗ ਭਾਰਤ ਵਿੱਚ ਖਰੀਦਦਾਰੀ ਕਰੋ.",
        "usp_sellers": "ਸਿੱਧੇ ਭਾਰਤੀ ਵਿਕਰੇਤਾਵਾਂ ਤੋਂ",
        "usp_shipping": "NZ ਨੂੰ 7-14 ਦਿਨਾਂ ਵਿੱਚ ਸ਼ਿਪਿੰਗ",
        "usp_payments": "NZD ਵਿੱਚ ਸੁਰੱਖਿਅਤ ਭੁਗਤਾਨ",
        "or": "ਜਾਂ",
        "continue_google": "Google ਨਾਲ ਜਾਰੀ ਰੱਖੋ",
        "sign_in": "ਸਾਈਨ ਇਨ",
    },
    "or": {  # Odia
        "eyebrow": "ଭାରତ → ନ୍ୟୁଜିଲାଣ୍ଡ",
        "cta": "ଇମେଲ ସହିତ ଆରମ୍ଭ କରନ୍ତୁ",
        "continue_signin": "ଆମ ସହ ପୂର୍ବରୁ କିଣାକାଟ କରୁଛନ୍ତି କି?",
        "hero_title": "ପ୍ରକୃତ ଭାରତ,\\nଆପଣଙ୍କ ଦୁଆରକୁ ପ୍ରଦାନ କରାଯାଇଛି.",
        "hero_subtitle": "ଯାତ୍ରା ବିନା, ଭାରତୀୟଙ୍କ ପରି ଭାରତରେ କିଣାକାଟ କରନ୍ତୁ.",
        "usp_sellers": "ଭାରତୀୟ ବିକ୍ରେତାଙ୍କଠାରୁ ସିଧାସଳଖ",
        "usp_shipping": "NZ କୁ 7-14 ଦିନରେ ସିପିଂ",
        "usp_payments": "NZD ରେ ସୁରକ୍ଷିତ ପେମେଣ୍ଟ",
        "or": "କିମ୍ବା",
        "continue_google": "Google ସହିତ ଜାରି ରଖନ୍ତୁ",
        "sign_in": "ସାଇନ ଇନ",
    },
    "as": {  # Assamese
        "eyebrow": "ভাৰত → নিউজিলেণ্ড",
        "cta": "ইমেইলৰ সৈতে আৰম্ভ কৰক",
        "continue_signin": "ইতিমধ্যে আমাৰ সৈতে কিনাকটা কৰি আছে?",
        "hero_title": "প্ৰকৃত ভাৰত,\\nআপোনাৰ দুৱাৰলৈ আনা হৈছে.",
        "hero_subtitle": "ভ্ৰমণ নকৰি, ভাৰতীয়সকলৰ দৰে ভাৰতত কিনাকটা কৰক.",
        "usp_sellers": "ভাৰতীয় বিক্ৰেতাসকলৰ পৰা পোনপটীয়াকৈ",
        "usp_shipping": "NZ লৈ 7-14 দিনত শিপিং",
        "usp_payments": "NZDত সুৰক্ষিত পেমেণ্ট",
        "or": "বা",
        "continue_google": "Googleৰ সৈতে অব্যাহত ৰাখক",
        "sign_in": "ছাইন ইন",
    },
}


def _build_block(keys: dict) -> str:
    """Build the welcome_* key lines for an auth block."""
    return (
        f',\n    welcome_eyebrow: "{keys["eyebrow"]}",\n'
        f'    welcome_cta: "{keys["cta"]}",\n'
        f'    welcome_continue_signin: "{keys["continue_signin"]}",\n'
        f'    welcome_hero_title: "{keys["hero_title"]}",\n'
        f'    welcome_hero_subtitle: "{keys["hero_subtitle"]}",\n'
        f'    welcome_usp_sellers: "{keys["usp_sellers"]}",\n'
        f'    welcome_usp_shipping: "{keys["usp_shipping"]}",\n'
        f'    welcome_usp_payments: "{keys["usp_payments"]}",\n'
        f'    welcome_or: "{keys["or"]}",\n'
        f'    welcome_continue_google: "{keys["continue_google"]}",\n'
        f'    welcome_sign_in: "{keys["sign_in"]}"'
    )


def patch_locale(locale: str, keys: dict) -> None:
    fp = ROOT / f"{locale}.ts"
    if not fp.exists():
        print(f"missing {fp}")
        return
    s = fp.read_text()
    if "welcome_hero_title" in s:
        print(f"[{locale}] already has welcome keys, skipping")
        return
    block = _build_block(keys)
    # Inline-style stubs end with: `... or: "..." }`  (no trailing comma, no
    # newlines inside the auth object).  Insert before the closing `}`.
    inline = re.search(r'(auth: \{[^{}]*or: "[^"]*")( ?})', s)
    if inline:
        s = s[: inline.end(1)] + block + s[inline.start(2):]
        fp.write_text(s)
        print(f"[{locale}] patched (inline)")
        return
    # Multi-line auth block (e.g. te.ts): find `or: "...",` then closing `},`
    multi = re.search(
        r'(auth: \{[\s\S]*?or: "[^"]*",)([\s\S]*?\n  \},)',
        s,
    )
    if multi:
        # Insert the new keys *just before* the closing `},`
        head = s[: multi.end(1)]
        inner_rest = multi.group(2)
        tail = s[multi.end():]  # everything AFTER the auth block — must keep!
        # Strip leading `,` from block since auth's last key already has a comma
        compact_block = block.lstrip(",")
        # Reformat with consistent indentation
        formatted = "\n" + "\n".join(
            f"    {ln.strip()}" for ln in compact_block.split("\n") if ln.strip()
        )
        s = head + formatted + inner_rest + tail
        fp.write_text(s)
        print(f"[{locale}] patched (multiline)")
        return
    print(f"[{locale}] FAILED to locate auth block")


for loc, keys in T.items():
    patch_locale(loc, keys)
