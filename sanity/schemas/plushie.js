export default {
  name: "plushie",
  title: "Plushie",
  type: "document",
  fields: [
    {
      name: "name",
      title: "Name",
      type: "string",
      description: 'The plushie’s name (e.g., "Pippa")',
      validation: (Rule) => Rule.required().max(60),
    },
    {
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "name", maxLength: 80 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: "pronouns",
      title: "Pronouns",
      type: "string",
      description: 'e.g., "she / her", "they / them"',
    },
    {
      name: "collection",
      title: "Collection",
      type: "reference",
      to: [{ type: "collection" }],
      description: "Which series does this plushie belong to?",
    },
    {
      name: "image",
      title: "Main Photo",
      type: "image",
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
    },
    {
      name: "gallery",
      title: "Extra Photos",
      type: "array",
      of: [{ type: "image", options: { hotspot: true } }],
    },
    {
      name: "personality",
      title: "Personality",
      type: "text",
      rows: 3,
      description: "A short paragraph in their voice or about them",
      validation: (Rule) => Rule.max(280),
    },
    {
      name: "snack",
      title: "Favorite Snack",
      type: "string",
    },
    {
      name: "stitchedOn",
      title: "Stitched On",
      type: "date",
      options: { dateFormat: "YYYY-MM-DD" },
    },
    {
      name: "weighted",
      title: "Weighted?",
      type: "boolean",
      initialValue: false,
    },
    {
      name: "weightGrams",
      title: "Weight (grams)",
      type: "number",
      hidden: ({ document }) => !document?.weighted,
    },
    {
      name: "price",
      title: "Adoption Fee (USD)",
      type: "number",
      validation: (Rule) => Rule.min(0),
    },
    {
      name: "status",
      title: "Status",
      type: "string",
      options: {
        list: [
          { title: "Available", value: "available" },
          { title: "Adopted", value: "adopted" },
          { title: "Coming Soon", value: "coming-soon" },
          { title: "On Hold", value: "on-hold" },
        ],
        layout: "radio",
      },
      initialValue: "available",
      validation: (Rule) => Rule.required(),
    },
    {
      name: "snipcartId",
      title: "Snipcart Product ID",
      type: "string",
      description: 'Optional — used for the "Add to cart" button when checkout is wired',
    },
  ],
  preview: {
    select: {
      title: "name",
      subtitle: "status",
      media: "image",
    },
    prepare({ title, subtitle, media }) {
      const pretty = {
        available: "✓ Available",
        adopted: "✗ Adopted",
        "coming-soon": "… Coming Soon",
        "on-hold": "✋ On Hold",
      };
      return { title, subtitle: pretty[subtitle] || subtitle, media };
    },
  },
};
