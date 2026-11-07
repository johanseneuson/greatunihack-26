// Fixed phrases spoken or shown by the assistant, in every supported language (so the accent and wording are native from the
// very first sentence, before the model has said anything). Also yes/no words for confirming actions by voice.
export interface Phrases { greet: (name: string, bot: string) => string; leave: string; lost: string; ahead: string }

export const PHRASES: Record<string, Phrases> = {
  English: { greet: (n, b) => `Hi ${n}, it's ${b}. What's on your mind?`, leave: "No problem, I'll leave it.", lost: 'Sorry, I lost the connection for a second. Could you say that again?', ahead: 'Shall I go ahead?' },
  Español: { greet: (n, b) => `Hola ${n}, soy ${b}. ¿En qué puedo ayudarte?`, leave: 'Sin problema, lo dejo como está.', lost: 'Perdona, se me cortó la conexión un segundo. ¿Puedes repetirlo?', ahead: '¿Lo hago?' },
  Polski: { greet: (n, b) => `Cześć ${n}, tu ${b}. W czym mogę pomóc?`, leave: 'Nie ma sprawy, zostawiam to.', lost: 'Przepraszam, na chwilę straciłam połączenie. Możesz powtórzyć?', ahead: 'Mam to zrobić?' },
  Português: { greet: (n, b) => `Olá ${n}, sou a ${b}. Em que posso ajudar?`, leave: 'Sem problema, deixo como está.', lost: 'Desculpa, perdi a ligação por um segundo. Podes repetir?', ahead: 'Posso avançar?' },
  Français: { greet: (n, b) => `Bonjour ${n}, c'est ${b}. Comment puis-je t'aider ?`, leave: 'Pas de souci, je laisse comme ça.', lost: "Désolée, j'ai perdu la connexion une seconde. Peux-tu répéter ?", ahead: 'Je le fais ?' },
  العربية: { greet: (n, b) => `مرحباً ${n}، أنا ${b}. كيف يمكنني مساعدتك؟`, leave: 'لا مشكلة، سأتركه كما هو.', lost: 'آسفة، انقطع الاتصال لثانية. هل يمكنك أن تعيد ما قلته؟', ahead: 'هل أمضي في ذلك؟' },
  Română: { greet: (n, b) => `Bună ${n}, sunt ${b}. Cu ce te pot ajuta?`, leave: 'Nicio problemă, las așa.', lost: 'Scuze, s-a pierdut conexiunea o secundă. Poți repeta?', ahead: 'Să continui?' },
  Italiano: { greet: (n, b) => `Ciao ${n}, sono ${b}. Come posso aiutarti?`, leave: "Nessun problema, lascio tutto com'è.", lost: 'Scusa, ho perso la connessione per un secondo. Puoi ripetere?', ahead: 'Vado avanti?' },
  हिन्दी: { greet: (n, b) => `नमस्ते ${n}, मैं ${b} हूँ। मैं आपकी कैसे मदद कर सकती हूँ?`, leave: 'कोई बात नहीं, मैं इसे ऐसे ही रहने देती हूँ।', lost: 'माफ़ कीजिए, एक पल के लिए कनेक्शन टूट गया था। क्या आप दोबारा बोल सकते हैं?', ahead: 'क्या मैं आगे बढ़ूँ?' },
  'Bengali (বাংলা)': { greet: (n, b) => `হ্যালো ${n}, আমি ${b}। আমি কীভাবে সাহায্য করতে পারি?`, leave: 'ঠিক আছে, আমি এটা এভাবেই রেখে দিচ্ছি।', lost: 'দুঃখিত, এক মুহূর্তের জন্য সংযোগ চলে গিয়েছিল। আপনি কি আবার বলবেন?', ahead: 'আমি কি এগিয়ে যাব?' },
  'Urdu (اردو)': { greet: (n, b) => `ہیلو ${n}، میں ${b} ہوں۔ میں آپ کی کیسے مدد کر سکتی ہوں؟`, leave: 'کوئی بات نہیں، میں اسے ایسے ہی رہنے دیتی ہوں۔', lost: 'معذرت، ایک لمحے کے لیے کنکشن ٹوٹ گیا تھا۔ کیا آپ دوبارہ بول سکتے ہیں؟', ahead: 'کیا میں آگے بڑھوں؟' },
}
export const phrases = (lang: string): Phrases => PHRASES[lang] ?? PHRASES.English

const YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'do it', 'go ahead', 'please do', 'confirm', 'sounds good',
  'sí', 'si', 'vale', 'claro', 'dale', 'tak', 'oui', "d'accord", 'sim', 'pode', 'da', 'sì', 'certo', 'certamente',
  'نعم', 'أجل', 'ايوه', 'أكيد', 'हाँ', 'हां', 'जी', 'ठीक', 'হ্যাঁ', 'হ্যা', 'জি', 'ঠিক আছে', 'ہاں', 'جی', 'ٹھیک']
const NO = ['no', 'nope', 'nah', "don't", 'do not', 'cancel that', 'leave it', 'not now', 'never mind',
  'nie', 'non', 'não', 'nao', 'nu', 'لا', 'नहीं', 'ना', 'না', 'নাহ', 'نہیں', 'نا']
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const starts = (words: string[]) => new RegExp(`^\\s*(?:${words.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
const YES_RX = starts(YES)
const NO_RX = starts(NO)
export const isYes = (t: string) => YES_RX.test(t)
export const isNo = (t: string) => NO_RX.test(t)
