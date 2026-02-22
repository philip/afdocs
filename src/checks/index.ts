// Import all check modules to trigger registration

// Category 1: llms.txt
import './llms-txt/llms-txt-exists.js';
import './llms-txt/llms-txt-valid.js';
import './llms-txt/llms-txt-size.js';
import './llms-txt/llms-txt-links-resolve.js';
import './llms-txt/llms-txt-links-markdown.js';

// Category 2: Markdown Availability
import './markdown-availability/markdown-url-support.js';
import './markdown-availability/content-negotiation.js';

// Category 3: Page Size
import './page-size/page-size-markdown.js';
import './page-size/page-size-html.js';
import './page-size/content-start-position.js';

// Category 4: Content Structure
import './content-structure/tabbed-content-serialization.js';
import './content-structure/section-header-quality.js';
import './content-structure/markdown-code-fence-validity.js';

// Category 5: URL Stability
import './url-stability/http-status-codes.js';
import './url-stability/redirect-behavior.js';

// Category 6: Agent Discoverability
import './agent-discoverability/llms-txt-directive.js';

// Category 7: Observability
import './observability/llms-txt-freshness.js';
import './observability/markdown-content-parity.js';
import './observability/cache-header-hygiene.js';

export { getCheck, getAllChecks, getChecksSorted } from './registry.js';
export { extractMarkdownLinks } from './llms-txt/llms-txt-valid.js';
