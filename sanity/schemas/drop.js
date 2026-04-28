export default {
  name: 'drop',
  title: 'Drop',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Drop Name',
      type: 'string',
      description: 'e.g., "Orchard Pals: Spring Restock"',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name' },
    },
    {
      name: 'dropAt',
      title: 'Goes Live At',
      type: 'datetime',
      description: 'When this drop becomes available — drives the homepage countdown',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'humanMeta',
      title: 'Friendly Date String',
      type: 'string',
      description: 'Shown beneath the drop name (e.g., "Friday, May 15 — 7:00pm CT"). Optional; auto-generated from dropAt if blank.',
    },
    {
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'string',
      description: 'Tiny label above the drop name (default: "The Next Drop")',
      initialValue: 'The Next Drop',
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
      description: 'Used in the email blast when the drop publishes',
    },
    {
      name: 'plushies',
      title: 'Plushies in This Drop',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'plushie' }] }],
    },
    {
      name: 'sendEmailOnPublish',
      title: 'Send drop email when published?',
      type: 'boolean',
      description: 'If on, publishing this drop fires a Loops automation to email subscribers.',
      initialValue: true,
    },
    {
      name: 'emailSentAt',
      title: 'Email Sent At',
      type: 'datetime',
      description: 'Auto-set by the webhook handler so we don’t double-send. Leave blank.',
      readOnly: true,
    },
  ],
  preview: {
    select: {
      title: 'name',
      subtitle: 'dropAt',
    },
    prepare({ title, subtitle }) {
      const when = subtitle
        ? new Date(subtitle).toLocaleString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'no date';
      return { title, subtitle: when };
    },
  },
  orderings: [
    {
      title: 'Soonest first',
      name: 'dropAtAsc',
      by: [{ field: 'dropAt', direction: 'asc' }],
    },
  ],
};
