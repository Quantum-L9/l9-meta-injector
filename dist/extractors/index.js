"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workIntelligenceExtractor = exports.documentStructureExtractor = exports.WORK_STATUS_VOCABULARY = exports.WORK_PREDICATES = exports.WORK_KIND_VOCABULARY = exports.repositoryStatusExtractor = exports.pythonRouteObservationExtractor = exports.declaredAuthorityExtractor = exports.workflowStructureExtractor = exports.staticImportExtractor = exports.nativeMetadataExtractor = exports.serviceSpecExtractor = exports.manifestExtractor = exports.contractReferenceExtractor = exports.contractInvariantsExtractor = void 0;
exports.defaultExtractors = defaultExtractors;
const structured_1 = require("./structured");
const native_metadata_1 = require("./native_metadata");
const static_imports_1 = require("./static_imports");
const workflows_1 = require("./workflows");
const prose_1 = require("./prose");
const work_intelligence_1 = require("./work_intelligence");
var structured_2 = require("./structured");
Object.defineProperty(exports, "contractInvariantsExtractor", { enumerable: true, get: function () { return structured_2.contractInvariantsExtractor; } });
Object.defineProperty(exports, "contractReferenceExtractor", { enumerable: true, get: function () { return structured_2.contractReferenceExtractor; } });
Object.defineProperty(exports, "manifestExtractor", { enumerable: true, get: function () { return structured_2.manifestExtractor; } });
Object.defineProperty(exports, "serviceSpecExtractor", { enumerable: true, get: function () { return structured_2.serviceSpecExtractor; } });
var native_metadata_2 = require("./native_metadata");
Object.defineProperty(exports, "nativeMetadataExtractor", { enumerable: true, get: function () { return native_metadata_2.nativeMetadataExtractor; } });
var static_imports_2 = require("./static_imports");
Object.defineProperty(exports, "staticImportExtractor", { enumerable: true, get: function () { return static_imports_2.staticImportExtractor; } });
var workflows_2 = require("./workflows");
Object.defineProperty(exports, "workflowStructureExtractor", { enumerable: true, get: function () { return workflows_2.workflowStructureExtractor; } });
var prose_2 = require("./prose");
Object.defineProperty(exports, "declaredAuthorityExtractor", { enumerable: true, get: function () { return prose_2.declaredAuthorityExtractor; } });
Object.defineProperty(exports, "pythonRouteObservationExtractor", { enumerable: true, get: function () { return prose_2.pythonRouteObservationExtractor; } });
Object.defineProperty(exports, "repositoryStatusExtractor", { enumerable: true, get: function () { return prose_2.repositoryStatusExtractor; } });
var work_intelligence_2 = require("./work_intelligence");
Object.defineProperty(exports, "WORK_KIND_VOCABULARY", { enumerable: true, get: function () { return work_intelligence_2.WORK_KIND_VOCABULARY; } });
Object.defineProperty(exports, "WORK_PREDICATES", { enumerable: true, get: function () { return work_intelligence_2.WORK_PREDICATES; } });
Object.defineProperty(exports, "WORK_STATUS_VOCABULARY", { enumerable: true, get: function () { return work_intelligence_2.WORK_STATUS_VOCABULARY; } });
Object.defineProperty(exports, "documentStructureExtractor", { enumerable: true, get: function () { return work_intelligence_2.documentStructureExtractor; } });
Object.defineProperty(exports, "workIntelligenceExtractor", { enumerable: true, get: function () { return work_intelligence_2.workIntelligenceExtractor; } });
/** Every extractor in the current interpretation profile. */
function defaultExtractors() {
    return [
        structured_1.contractInvariantsExtractor,
        structured_1.contractReferenceExtractor,
        prose_1.declaredAuthorityExtractor,
        work_intelligence_1.documentStructureExtractor,
        structured_1.manifestExtractor,
        native_metadata_1.nativeMetadataExtractor,
        prose_1.pythonRouteObservationExtractor,
        prose_1.repositoryStatusExtractor,
        structured_1.serviceSpecExtractor,
        static_imports_1.staticImportExtractor,
        workflows_1.workflowStructureExtractor,
        work_intelligence_1.workIntelligenceExtractor,
    ];
}
//# sourceMappingURL=index.js.map