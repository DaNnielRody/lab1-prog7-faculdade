import re
from collections import Counter

ELLIPSIS = "…"

SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+")
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)

STOPWORDS = {
    "a", "ao", "aos", "as", "até", "com", "como", "da", "das", "de", "dela", "delas", "dele",
    "deles", "depois", "do", "dos", "e", "ela", "elas", "ele", "eles", "em", "entre", "era",
    "eram", "essa", "essas", "esse", "esses", "esta", "estas", "este", "estes", "eu", "foi",
    "foram", "há", "isso", "isto", "já", "lhe", "lhes", "mais", "mas", "me", "mesmo", "meu",
    "meus", "minha", "minhas", "muito", "na", "nas", "nem", "no", "nos", "nós", "nossa", "o",
    "os", "ou", "para", "pela", "pelas", "pelo", "pelos", "por", "qual", "quando", "que", "quem",
    "se", "sem", "ser", "seu", "seus", "só", "sua", "suas", "também", "te", "tem", "têm", "tenho",
    "ter", "teu", "teus", "tu", "tua", "tuas", "um", "uma", "umas", "uns", "vai", "você", "vocês",
    "à", "às", "é", "então", "aqui", "ali", "lá", "muita", "muitos", "muitas", "todo", "toda",
    "todos", "todas", "outro", "outra", "sobre", "assim", "ainda", "porque", "pois", "onde",
    "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had", "has", "have",
    "he", "her", "his", "i", "if", "in", "is", "it", "its", "just", "like", "me", "my", "not",
    "of", "on", "or", "our", "she", "so", "than", "that", "the", "their", "them", "then",
    "there", "these", "they", "this", "to", "was", "we", "were", "what", "when", "which",
    "who", "will", "with", "you", "your", "el", "la", "los", "las", "un", "una", "y", "que",
    "de", "del", "por", "para", "con", "sin", "es", "son", "muy", "pero", "como", "más",
}


def normalize(text):
    return re.sub(r"\s+", " ", (text or "")).strip()


def split_sentences(text):
    return [s for s in (part.strip() for part in SENTENCE_SPLIT.split(text)) if s]


def hard_clamp(text, max_chars):
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    budget = max_chars - 1
    if budget <= 0:
        return ELLIPSIS
    head = text[:budget]
    space = head.rfind(" ")
    if space > 0:
        head = head[:space]
    head = head.rstrip(" ,;:-–—")
    return (head + ELLIPSIS) if head else ELLIPSIS


def score_sentences(sentences):
    frequencies = Counter()
    tokenized = []

    for sentence in sentences:
        words = [w.lower() for w in WORD.findall(sentence)]
        content = [w for w in words if w not in STOPWORDS and len(w) > 2]
        tokenized.append(content)
        frequencies.update(content)

    if not frequencies:
        return [1.0] * len(sentences)

    peak = max(frequencies.values())
    total = len(sentences)
    scores = []

    for index, content in enumerate(tokenized):
        if not content:
            scores.append(0.0)
            continue
        weight = sum(frequencies[w] / peak for w in content) / (len(content) ** 0.5)
        position_bonus = 1.0 + (0.25 * (1.0 - index / total))
        scores.append(weight * position_bonus)

    return scores


def summarize(transcript, max_chars=500):
    text = normalize(transcript)
    if not text:
        return ""
    if len(text) <= max_chars:
        return text

    sentences = split_sentences(text)
    if len(sentences) <= 1:
        return hard_clamp(text, max_chars)

    scores = score_sentences(sentences)
    ranked = sorted(range(len(sentences)), key=lambda i: scores[i], reverse=True)

    chosen = []
    length = 0
    for index in ranked:
        candidate = sentences[index]
        extra = len(candidate) + (1 if chosen else 0)
        if length + extra > max_chars:
            continue
        chosen.append(index)
        length += extra

    if not chosen:
        return hard_clamp(sentences[0], max_chars)

    summary = " ".join(sentences[i] for i in sorted(chosen))
    return hard_clamp(summary, max_chars)
