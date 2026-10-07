// Synthetic demo forms (Issue #24). Self-made demonstration content, not official healthcare
// forms and not clinically validated. Seeded as ordinary templates, so the admin editor,
// form filling, drafts, prefill and submitted forms all work on them unchanged.
import type { Pool, PoolConnection } from "mariadb";
import {
  validateField,
  validateTemplate,
  type FieldInput,
  type FieldType,
  type TemplateInput,
} from "../forms/validation.js";

type DemoField = {
  label: string;
  description?: string;
  fieldType: FieldType;
  required?: boolean;
  options?: string[];
};

export type DemoForm = {
  /** Stable identifier stored in form_templates.seed_key. Never change it for an existing form. */
  key: string;
  name: string;
  description: string;
  category: string;
  fields: DemoField[];
};

const SCALE_HELP = "0 = ei lainkaan, 10 = voimakkain mahdollinen.";
const IMPACT = ["Ei vaikutusta", "Vähän", "Kohtalaisesti", "Paljon"];

export const DEMO_FORMS: DemoForm[] = [
  {
    key: "demo-vastaanotto",
    name: "Vastaanoton esitiedot",
    description: "Asioinnin syy, vaivan kesto ja muut tiedot ennen vastaanottokäyntiä.",
    category: "Yleinen",
    fields: [
      {
        label: "Asioinnin syy",
        description: "Kerro lyhyesti, mihin tarvitset apua.",
        fieldType: "TEXT",
        required: true,
      },
      {
        label: "Kuinka kauan vaiva on jatkunut?",
        fieldType: "SELECT",
        required: true,
        options: ["Alle viikon", "1–4 viikkoa", "1–6 kuukautta", "Yli 6 kuukautta", "En osaa sanoa"],
      },
      { label: "Milloin vaiva alkoi?", description: "Arvio riittää.", fieldType: "DATE" },
      {
        label: "Onko vaiva muuttunut viime aikoina?",
        fieldType: "SELECT",
        options: ["Pahentunut", "Pysynyt ennallaan", "Helpottanut", "En osaa sanoa"],
      },
      {
        label: "Oletko asioinut saman vaivan vuoksi aiemmin?",
        fieldType: "SELECT",
        options: ["Kyllä", "Ei", "En muista"],
      },
      {
        label: "Toivottu asiointitapa",
        fieldType: "SELECT",
        required: true,
        options: ["Vastaanottokäynti", "Puhelu", "Etäyhteys", "Ei toivetta"],
      },
      { label: "Muuta huomioitavaa", fieldType: "TEXT" },
    ],
  },
  {
    key: "demo-oireet",
    name: "Oireiden esitiedot",
    description: "Oireen kuvaus, alkamisajankohta, toistuvuus ja vaikutus arkeen.",
    category: "Oireet",
    fields: [
      {
        label: "Pääasiallinen oire",
        description: "Kuvaa oire omin sanoin.",
        fieldType: "TEXT",
        required: true,
      },
      { label: "Milloin oire alkoi?", description: "Arvio riittää.", fieldType: "DATE", required: true },
      {
        label: "Kuinka usein oire esiintyy?",
        fieldType: "SELECT",
        required: true,
        options: ["Jatkuvasti", "Päivittäin", "Viikoittain", "Harvemmin", "Vain kerran"],
      },
      {
        label: "Oireen voimakkuus asteikolla 0–10",
        description: SCALE_HELP,
        fieldType: "NUMBER",
        required: true,
      },
      { label: "Miten oire vaikuttaa arkeesi?", fieldType: "SELECT", options: IMPACT },
      { label: "Muut samanaikaiset oireet", fieldType: "TEXT" },
    ],
  },
  {
    key: "demo-kipu",
    name: "Kivun esitiedot",
    description: "Kivun sijainti, kesto, voimakkuus ja vaikutus päivittäisiin toimiin.",
    category: "Kipu",
    fields: [
      { label: "Missä kipu tuntuu?", fieldType: "TEXT", required: true },
      {
        label: "Kuinka kauan kipu on jatkunut?",
        fieldType: "SELECT",
        required: true,
        options: ["Alle viikon", "1–4 viikkoa", "1–3 kuukautta", "Yli 3 kuukautta"],
      },
      {
        label: "Kivun voimakkuus nyt asteikolla 0–10",
        description: SCALE_HELP,
        fieldType: "NUMBER",
        required: true,
      },
      {
        label: "Millaista kipu on?",
        fieldType: "SELECT",
        options: ["Jomottava", "Pistävä", "Polttava", "Säteilevä", "Sykkivä", "Muu"],
      },
      {
        label: "Milloin kipu on pahimmillaan?",
        fieldType: "SELECT",
        options: ["Aamulla", "Päivällä", "Illalla", "Yöllä", "Liikkuessa", "Levossa", "Ei selvää ajankohtaa"],
      },
      { label: "Haittaako kipu päivittäisiä toimiasi?", fieldType: "SELECT", required: true, options: IMPACT },
      { label: "Mikä helpottaa kipua?", fieldType: "TEXT" },
    ],
  },
  {
    key: "demo-hyvinvointi",
    name: "Mielialan ja hyvinvoinnin esitiedot",
    description: "Yleinen vointi, mieliala, kuormitus ja toiveet tuesta.",
    category: "Hyvinvointi",
    fields: [
      {
        label: "Millainen vointisi on ollut viime aikoina?",
        fieldType: "SELECT",
        required: true,
        options: ["Hyvä", "Melko hyvä", "Vaihteleva", "Melko huono", "Huono"],
      },
      {
        label: "Millainen mielialasi on ollut kahden viime viikon aikana?",
        fieldType: "SELECT",
        required: true,
        options: ["Tavallinen", "Hieman tavallista matalampi", "Selvästi tavallista matalampi", "Vaihteleva"],
      },
      {
        label: "Koettu stressi asteikolla 0–10",
        description: "0 = ei lainkaan stressiä, 10 = erittäin paljon stressiä.",
        fieldType: "NUMBER",
      },
      { label: "Mikä kuormittaa sinua tällä hetkellä?", fieldType: "TEXT" },
      { label: "Vaikuttaako vointisi arjessa jaksamiseen?", fieldType: "SELECT", options: IMPACT },
      {
        label: "Millaista tukea toivoisit?",
        fieldType: "SELECT",
        options: [
          "Keskustelu ammattilaisen kanssa",
          "Tietoa ja itsehoito-ohjeita",
          "Ryhmätoiminta",
          "En osaa sanoa",
        ],
      },
      { label: "Muuta kerrottavaa", fieldType: "TEXT" },
    ],
  },
  {
    key: "demo-uni",
    name: "Unen ja palautumisen esitiedot",
    description: "Unen määrä ja laatu, nukahtaminen, yöheräily ja palautuminen.",
    category: "Uni ja palautuminen",
    fields: [
      {
        label: "Kuinka monta tuntia nukut keskimäärin yössä?",
        description: "Esimerkiksi 7 tai 6,5.",
        fieldType: "NUMBER",
        required: true,
      },
      {
        label: "Millainen unesi laatu on?",
        fieldType: "SELECT",
        required: true,
        options: ["Hyvä", "Kohtalainen", "Huono", "Vaihtelee"],
      },
      {
        label: "Onko sinulla vaikeuksia nukahtaa?",
        fieldType: "SELECT",
        options: ["Ei", "Joskus", "Usein", "Lähes joka yö"],
      },
      {
        label: "Heräiletkö öisin?",
        fieldType: "SELECT",
        options: ["Harvoin", "Joskus", "Usein", "Lähes joka yö"],
      },
      {
        label: "Tunnetko olosi levänneeksi herätessäsi?",
        fieldType: "SELECT",
        options: ["Yleensä", "Joskus", "Harvoin"],
      },
      { label: "Miten väsymys vaikuttaa päiviisi?", fieldType: "TEXT" },
      { label: "Milloin univaikeudet alkoivat?", description: "Arvio riittää.", fieldType: "DATE" },
    ],
  },
  {
    key: "demo-laakitys",
    name: "Lääkitystiedot",
    description: "Käytössä oleva lääke, annostus ja käytön syy. Täytä erikseen jokaisesta lääkkeestä.",
    category: "Lääkitys",
    fields: [
      { label: "Lääkkeen nimi", fieldType: "TEXT", required: true },
      { label: "Vahvuus ja annos", description: "Esimerkiksi 500 mg, 1 tabletti.", fieldType: "TEXT" },
      {
        label: "Kuinka usein käytät lääkettä?",
        fieldType: "SELECT",
        required: true,
        options: ["Kerran päivässä", "Useita kertoja päivässä", "Viikoittain", "Tarvittaessa", "Muu"],
      },
      { label: "Käytön syy", fieldType: "TEXT" },
      { label: "Milloin aloitit lääkkeen käytön?", description: "Arvio riittää.", fieldType: "DATE" },
      {
        label: "Onko lääke lääkärin määräämä?",
        fieldType: "SELECT",
        options: ["Kyllä", "Ei, itsehoitolääke", "En tiedä"],
      },
      { label: "Lisätietoja", fieldType: "TEXT" },
    ],
  },
  {
    key: "demo-allergiat",
    name: "Allergiatiedot",
    description: "Tunnettu allergia tai yliherkkyys, sen oireet ja reaktioiden voimakkuus.",
    category: "Allergiat",
    fields: [
      {
        label: "Mille olet allerginen?",
        description: "Esimerkiksi ruoka-aine, lääke, siitepöly tai eläin.",
        fieldType: "TEXT",
        required: true,
      },
      {
        label: "Allergian tyyppi",
        fieldType: "SELECT",
        required: true,
        options: ["Ruoka-aine", "Lääke", "Siitepöly", "Eläin", "Hyönteisen pisto", "Muu"],
      },
      { label: "Millaisia oireita allergia aiheuttaa?", fieldType: "TEXT" },
      {
        label: "Kuinka voimakkaita reaktiot ovat olleet?",
        fieldType: "SELECT",
        required: true,
        options: ["Lieviä", "Kohtalaisia", "Voimakkaita", "En tiedä"],
      },
      {
        label: "Onko allergia todettu tutkimuksin?",
        fieldType: "SELECT",
        options: ["Kyllä", "Ei", "En tiedä"],
      },
      { label: "Lisätietoja", fieldType: "TEXT" },
    ],
  },
  {
    key: "demo-toimintakyky",
    name: "Toimintakyvyn esitiedot",
    description: "Arjen toimista suoriutuminen, liikkuminen ja avun tarve.",
    category: "Toimintakyky",
    fields: [
      {
        label: "Miten suoriudut arjen toimista?",
        fieldType: "SELECT",
        required: true,
        options: ["Itsenäisesti", "Pienellä avulla", "Tarvitsen paljon apua"],
      },
      {
        label: "Miten liikut kotona ja kodin ulkopuolella?",
        fieldType: "SELECT",
        required: true,
        options: ["Ilman apuvälineitä", "Apuvälineen kanssa", "Toisen henkilön avustamana"],
      },
      {
        label: "Kuinka monta metriä jaksat kävellä yhtäjaksoisesti?",
        description: "Arvio riittää.",
        fieldType: "NUMBER",
      },
      {
        label: "Vaikuttaako tilanne työhön tai opiskeluun?",
        fieldType: "SELECT",
        options: [...IMPACT, "Ei koske minua"],
      },
      {
        label: "Missä asioissa tarvitset apua?",
        description: "Esimerkiksi kauppa-asiointi, siivous tai peseytyminen.",
        fieldType: "TEXT",
      },
      {
        label: "Saatko tällä hetkellä apua läheisiltä tai palveluista?",
        fieldType: "SELECT",
        options: ["Kyllä", "Osittain", "Ei"],
      },
      { label: "Lisätietoja", fieldType: "TEXT" },
    ],
  },
];

/** Runs the demo data through the same validation as the admin API, so seeded forms obey its rules. */
export function validateDemoForm(form: DemoForm): { template: TemplateInput; fields: FieldInput[] } {
  const template = validateTemplate(form);
  const errors = [Object.keys(template.errors).length > 0 ? template.errors : null];
  const fields = form.fields.map((field) => {
    const result = validateField(field);
    if (Object.keys(result.errors).length > 0) errors.push(result.errors);
    return result.value;
  });
  const failed = errors.filter(Boolean);
  if (failed.length > 0) {
    throw new Error(`Invalid demo form "${form.key}": ${JSON.stringify(failed)}`);
  }
  return { template: template.value, fields };
}

export type SeedResult = { created: string[]; skipped: string[] };

/**
 * Creates each form whose seed key does not exist yet, as a PUBLISHED template.
 * Existing forms are skipped entirely, so admin edits (rename, unpublish, field changes) survive.
 * Never updates or deletes templates. A form deleted by an admin is recreated on the next run.
 */
export async function seedDemoForms(pool: Pool, forms: DemoForm[] = DEMO_FORMS): Promise<SeedResult> {
  const result: SeedResult = { created: [], skipped: [] };
  // Validate everything first so bad data never leaves a partial library.
  const validated = forms.map((form) => ({ form, ...validateDemoForm(form) }));

  for (const { form, template, fields } of validated) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const existing = await conn.query("SELECT id FROM form_templates WHERE seed_key = ?", [form.key]);
      if (existing.length > 0) {
        await conn.rollback();
        result.skipped.push(form.key);
        continue;
      }
      await insertForm(conn, form.key, template, fields);
      await conn.commit();
      result.created.push(form.key);
    } catch (err) {
      await conn.rollback();
      // A concurrent run created the same form first; the unique seed_key kept it single.
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
        result.skipped.push(form.key);
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
  return result;
}

async function insertForm(conn: PoolConnection, key: string, template: TemplateInput, fields: FieldInput[]) {
  const inserted = await conn.query(
    `INSERT INTO form_templates (name, description, category, seed_key, status)
     VALUES (?, ?, ?, ?, 'PUBLISHED')`,
    [template.name, template.description, template.category, key],
  );
  const templateId = Number(inserted.insertId);
  for (const [index, field] of fields.entries()) {
    await conn.query(
      `INSERT INTO form_fields
         (form_template_id, label, description, field_type, is_required, options, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        templateId,
        field.label,
        field.description,
        field.fieldType,
        field.required,
        field.options ? JSON.stringify(field.options) : null,
        index + 1,
      ],
    );
  }
}
