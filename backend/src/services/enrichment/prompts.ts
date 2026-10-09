/**
 * Prompt templates (012-arabic-catalog-enrichment, T007).
 *
 * One template per field. Each template includes:
 *   - Arabic-output instruction (FR-DRAFT-003 + research §R-4 validator).
 *   - Western-digit instruction (R127-L7 / B14-6): the site-wide
 *     numerals canon is Western 0-9 (utils.ts CLDR pins) — without an
 *     explicit constraint the model ships Arabic-Indic ٠-٩ into
 *     generated catalog copy.
 *   - The product's existing context (name, current description, category).
 *   - An explicit shape for the response so the validator has a
 *     predictable target.
 *
 * Tweak these here when prompt-template calibration during the pilot
 * argues for it; the runner's audit row keeps a snapshot of token spend
 * before and after every template change.
 */

export type FieldName = "description" | "description_long" | "faq";

export interface PromptContext {
  productId: number;
  productName: string;
  category: string | null;
  currentDescription: string | null;
  currentDescriptionLong: string | null;
  currentFaq: Array<{ question: string; answer: string }> | null;
  currentUsageTerms: string | null;
}

export function buildPrompt(field: FieldName, ctx: PromptContext): string {
  switch (field) {
    case "description":
      return [
        "أنت كاتب محتوى تسويقي للسوق الليبي. الهدف: كتابة وصف قصير وجذاب للمنتج باللغة العربية الفصحى.",
        "",
        "المنتج:",
        `- الاسم: ${ctx.productName}`,
        ctx.category ? `- الفئة: ${ctx.category}` : "",
        ctx.currentDescriptionLong ? `- وصف طويل: ${ctx.currentDescriptionLong.slice(0, 600)}` : "",
        "",
        "المطلوب:",
        "- وصف عربي قصير، بين 80 و 250 حرفاً.",
        "- صياغة واضحة، بدون تكرار، بدون رموز ترويجية مزعجة.",
        "- لا تذكر السعر أو خصومات وهمية.",
        "- استخدم الأرقام الغربية (0-9) في كل المخرجات.",
        "- اخرج النص فقط، بدون عناوين أو أقواس.",
      ]
        .filter(Boolean)
        .join("\n");

    case "description_long":
      return [
        "أنت كاتب محتوى تسويقي للسوق الليبي. الهدف: كتابة وصف طويل ومفيد للمنتج باللغة العربية الفصحى.",
        "",
        "المنتج:",
        `- الاسم: ${ctx.productName}`,
        ctx.category ? `- الفئة: ${ctx.category}` : "",
        ctx.currentDescription ? `- وصف قصير حالي: ${ctx.currentDescription}` : "",
        ctx.currentUsageTerms ? `- شروط الاستخدام: ${ctx.currentUsageTerms.slice(0, 400)}` : "",
        "",
        "المطلوب:",
        "- وصف عربي بين 400 و 1500 حرف.",
        "- يشرح الميزات الرئيسية والفائدة للعميل بلغة طبيعية.",
        "- يقسم المحتوى إلى فقرات قصيرة (2-4 فقرات).",
        "- لا يستخدم القوائم النقطية ولا العناوين الفرعية.",
        "- لا يذكر السعر أو وعوداً غير قابلة للتحقق.",
        "- استخدم الأرقام الغربية (0-9) في كل المخرجات.",
        "- اخرج النص فقط، بدون عناوين تمهيدية.",
      ]
        .filter(Boolean)
        .join("\n");

    case "faq":
      return [
        "أنت كاتب محتوى. الهدف: إنشاء قسم أسئلة متكررة لمنتج رقمي، باللغة العربية الفصحى.",
        "",
        "المنتج:",
        `- الاسم: ${ctx.productName}`,
        ctx.category ? `- الفئة: ${ctx.category}` : "",
        ctx.currentDescription ? `- الوصف: ${ctx.currentDescription}` : "",
        ctx.currentUsageTerms ? `- شروط الاستخدام: ${ctx.currentUsageTerms.slice(0, 400)}` : "",
        "",
        "المطلوب:",
        "- بين 3 و 6 أسئلة شائعة.",
        "- كل سؤال قصير وواضح، وكل إجابة بين 30 و 250 حرفاً.",
        "- المخرجات بصيغة JSON صرفة (بدون أي شرح خارج JSON):",
        '  [{"question": "...", "answer": "..."}, ...]',
        "- لا تذكر السعر أو وعوداً تجارية. ركّز على الاستخدام، الدعم، والمشاكل الشائعة.",
        "- استخدم الأرقام الغربية (0-9) في كل المخرجات.",
      ]
        .filter(Boolean)
        .join("\n");
  }
}

/**
 * Try to parse the LLM response as a JSON array of {question, answer}.
 * Returns null when the response is not parseable JSON of the expected
 * shape — the validator will then mark the draft as `draft_invalid`.
 */
export function tryParseFaq(text: string): Array<{ question: string; answer: string }> | null {
  // Strip code fences if the model wrapped the output.
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    if (
      !parsed.every(
        (entry: unknown) =>
          entry != null &&
          typeof entry === "object" &&
          typeof (entry as { question: unknown }).question === "string" &&
          typeof (entry as { answer: unknown }).answer === "string",
      )
    ) {
      return null;
    }
    return parsed as Array<{ question: string; answer: string }>;
  } catch {
    return null;
  }
}
