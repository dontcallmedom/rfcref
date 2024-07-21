This project provides an opportunity to collect ABNF extracted from RFCs and consolidate them into a version that can be parsed with all rules possibly referenced from other RFCs.

* `tools` contains the node.js scripts that allows to do that consolidation.
* `source` contains the ABNF fragments extracted from RFCs (with errata included if possible)
* `dependencies` contains JSON description of the dependencies identifying which terms are imported from or are extending terms of other RFCs.
* `consolidated` contains the consolidated ABNF.
