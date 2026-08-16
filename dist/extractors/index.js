"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repositoryStatusExtractor = exports.pythonRouteObservationExtractor = exports.declaredAuthorityExtractor = exports.serviceSpecExtractor = exports.manifestExtractor = exports.contractInvariantsExtractor = void 0;
exports.defaultExtractors = defaultExtractors;
const structured_1 = require("./structured");
const prose_1 = require("./prose");
var structured_2 = require("./structured");
Object.defineProperty(exports, "contractInvariantsExtractor", { enumerable: true, get: function () { return structured_2.contractInvariantsExtractor; } });
Object.defineProperty(exports, "manifestExtractor", { enumerable: true, get: function () { return structured_2.manifestExtractor; } });
Object.defineProperty(exports, "serviceSpecExtractor", { enumerable: true, get: function () { return structured_2.serviceSpecExtractor; } });
var prose_2 = require("./prose");
Object.defineProperty(exports, "declaredAuthorityExtractor", { enumerable: true, get: function () { return prose_2.declaredAuthorityExtractor; } });
Object.defineProperty(exports, "pythonRouteObservationExtractor", { enumerable: true, get: function () { return prose_2.pythonRouteObservationExtractor; } });
Object.defineProperty(exports, "repositoryStatusExtractor", { enumerable: true, get: function () { return prose_2.repositoryStatusExtractor; } });
/** Every extractor in the current interpretation profile. */
function defaultExtractors() {
    return [
        structured_1.contractInvariantsExtractor,
        prose_1.declaredAuthorityExtractor,
        structured_1.manifestExtractor,
        prose_1.pythonRouteObservationExtractor,
        prose_1.repositoryStatusExtractor,
        structured_1.serviceSpecExtractor,
    ];
}
//# sourceMappingURL=index.js.map