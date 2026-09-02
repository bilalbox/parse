/**
 * The class names Rescue writes into an Article, and the selectors its readers
 * match. Rescue re-attaches content Readability discarded as boilerplate: the
 * web featured image, an email's dropped images and call-to-action links.
 *
 * These names are a contract between three runtimes — the ingest adapters that
 * write them (Worker), Narration and the reader that match them (client), and
 * the stylesheet that styles them. Imported here rather than retyped, so
 * renaming a section cannot silently break narration skipping.
 *
 * `src/app.css` is the one consumer that cannot import them; `test/rescue-contract.spec.ts`
 * guards it instead.
 */

/** Email images Readability dropped, re-attached as their own section. */
export const RESCUED_IMAGES_CLASS = 'parsed-rescued-images';

/** Email call-to-action links Readability dropped, re-attached as their own section. */
export const ACTION_LINKS_CLASS = 'parsed-action-links';

/** The hero image Readability dropped, re-inserted at the top of the Article. */
export const FEATURED_IMAGE_CLASS = 'featured-image-container';

/**
 * The rescued sections Narration skips. They are lists of URLs, so reading them
 * aloud gives the listener a recital of link text and nothing else.
 */
export const RESCUED_SECTION_SELECTOR = `.${ACTION_LINKS_CLASS}, .${RESCUED_IMAGES_CLASS}`;

/** The rescued featured image itself, which is the Article's artwork when there is one. */
export const FEATURED_IMAGE_SELECTOR = `.${FEATURED_IMAGE_CLASS} img`;
