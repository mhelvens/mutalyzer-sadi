////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// imports                                                                                                            //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/* external libs */
import _          from 'lodash';
import express    from 'express';
import favicon    from 'serve-favicon';
import Soap       from 'soap-as-promised';
import Handlebars from 'handlebars';
import promisify  from 'es6-promisify';
const swaggerMiddleware = promisify(require('swagger-express-middleware'));

/* local stuff */
import {inspect} from './utility.es6.js';
import {OK} from './http-status-codes.es6.js';
import {
	MutalyzerError,
	errorNormalizer,
	errorLogger,
	errorTransmitter,
	doneWithError
} from './errors.es6.js';


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SOAP specific utility function                                                                                     //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function soapOperation(soap, operation, params) {
	/* call the Mutalyzer SOAP server */
	let result = [...Object.values(await soap[operation](params))][0];

	/* 'flatten' the SOAP output */
	for (let [key, value] of Object.entries(result)) {
		if (_.isPlainObject(value)) {
			result[key] = [...Object.values(value)][0];
		}
	}

	/* throw any errors */
	if (result.errors > 0) {
		for (let msg of result.messages) {
			if (msg.errorcode[0] === 'E') {
				throw new MutalyzerError(msg);
			}
		}
	}

	/* return the result */
	return result;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Turtle templates                                                                                                   //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const ttl = {

	runMutalyzer: Handlebars.compile(require('raw!./templates/runMutalyzer._ttl')),

    info: Handlebars.compile(require('raw!./templates/runMutalyzer._ttl')),

    getTranscriptsAndInfo: Handlebars.compile(require('raw!./templates/getTranscriptsAndInfo._ttl'))

	// <-- insert templates for other API responses here

};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// operations                                                                                                         //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const operations = {

	async runMutalyzer({soap, mimeType, req, res}) {
		/* extract the expected parameters */
		const params = _.pick(req.query, ['variant']);

		/* call the Mutalyzer SOAP server */
		let runMutalyzerResult = await soapOperation(soap, 'runMutalyzer', params);
		/* translate result to Turtle when that mime type was requested */
		if (mimeType === 'text/turtle') {
			runMutalyzerResult = ttl.runMutalyzer(_.cloneDeep(
				{...params, ...runMutalyzerResult},
				(val, key) => {
					/* escaping certain characters */
					if (_.isString(val)) { return val.replace(/\./g, '\\.') }
				}
			));
		}

		/* send the result */
		res.status(OK).set('content-type', mimeType).send(runMutalyzerResult);
	},

    async info({soap, mimeType, req, res}) {
        /* extract the expected parameters */
        const params = {};

        /* call the Mutalyzer SOAP server */
        let infoResult = await soapOperation(soap, 'info', params);

        /* translate result to Turtle when that mime type was requested */
        if (mimeType === 'text/turtle') {
            infoResult = ttl.info(_.cloneDeep(
                {...params, ...infoResult},
                (val, key) => {
                    /* escaping certain characters */
                    if (_.isString(val)) { return val.replace(/\./g, '\\.') }
                }
            ));
        }

        /* send the result */
        res.status(OK).set('content-type', mimeType).send(infoResult);
    },

    async getTranscriptsAndInfo({soap, mimeType, req, res}) {
        /* extract the expected parameters */
        const params = _.pick(req.query, ['genomicReference', 'geneName']);
        /* call the Mutalyzer SOAP server */
        let getTranscriptsAndInfoResult = await soapOperation(soap, 'getTranscriptsAndInfo', params);

        /* translate result to Turtle when that mime type was requested */
        if (mimeType === 'text/turtle') {
			var N3 = require('n3');
			var N3Util = N3.Util;
			var hash = {};
			var writer = N3.Writer({ prefixes: { rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
				rsa: 'http://rdf.biosemantics.org/ontologies/rsa#', rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
				dcterms: 'http://purl.org/dc/terms/', so: 'http://purl.obolibrary.org/obo/',
				edam: 'http://edamontology.org/'} });
			var countTrans = 0;
            _.cloneDeep({...params, ...getTranscriptsAndInfoResult},
				(val, key) => {
					console.log(" key == " + key + " val == " + val);
					if (key === "genomicReference") {
						hash['genomicReference'] = val;
					}
					else if (key === "gTransStart") {
						countTrans = countTrans + 1;
						hash['transcript' + countTrans + "Start"] = val;
					}
					else if (key === "gTransEnd") {
						hash['transcript' + countTrans + "End"] = val;
					}
					else if (key === "id" && val.indexOf('NM') > -1) {
						hash['transcript' + countTrans] = val;
					}
					else if (key === "id" && val.indexOf('NP') > -1) {
						hash['proteinRef' + countTrans] = val;
					}
					else if (key === "id") {
						countTrans = countTrans -1;
					}
                }
            );
			if (countTrans > 0) {
				var val = hash['genomicReference'];
				var gTrans = ("http://www.ncbi.nlm.nih.gov/nuccore/" + val);
				var idOrgTransPrefix = ("http://identifiers.org/refseq/");
				var uniProtTransPrefix = ("http://purl.uniprot.org/refseq/");
				writer.addTriple(gTrans, 'rdf:type', 'rsa:GenomicReferenceSequence');
				writer.addTriple(gTrans, 'rdf:label', N3Util.createLiteral(val));
				writer.addTriple(gTrans, 'dcterms:identifiers', N3Util.createLiteral(val));

				for(var count = 1; count <= countTrans ; count++){
					var transVal = hash['transcript' + count];
					var transAccessionVal  = transVal.split(".", 2)[0];
					var proteinTransVal = hash['proteinRef' + count];
					var transcript = ("http://www.ncbi.nlm.nih.gov/nuccore/" + transVal);
					var transAccession = ("http://www.ncbi.nlm.nih.gov/nuccore/" + transAccessionVal);
					var proteinTrans = ("http://www.ncbi.nlm.nih.gov/protein/" + proteinTransVal);
					var transAnnotation =
						("https://mutalyzer.nl/nuccore/" + transVal + "/annotation/1");
					var transRegion =
						("https://mutalyzer.nl/nuccore/" + transVal + "/annotation/1/region/1");
					writer.addTriple(transcript, 'rsa:isSubSequenceOf', gTrans);
					writer.addTriple(transcript, 'rdf:type', 'rsa:TranscriptReferenceSequence');
					writer.addTriple(transcript, 'rdf:label', N3Util.createLiteral(transVal));
					writer.addTriple(transcript, 'dcterms:identifiers', N3Util.createLiteral(transVal));
					writer.addTriple(transcript, 'rsa:hasAnnotation', transAnnotation);
					writer.addTriple(transcript, 'rdfs:seeAlso', (idOrgTransPrefix + transVal));
					writer.addTriple(transcript, 'rdfs:seeAlso', transAccession);
					writer.addTriple(proteinTrans, 'so:so_associated_with', transcript); // see this link for predicate docs http://www.ncbi.nlm.nih.gov/books/NBK21091/table/ch18.T.refseq_accession_numbers_and_mole/?report=objectonly
					writer.addTriple(proteinTrans, 'rdf:type', 'rsa:ProteinReferenceSequence');
					writer.addTriple(proteinTrans, 'rdf:label', N3Util.createLiteral(proteinTransVal));
					writer.addTriple(proteinTrans, 'dcterms:identifiers',
						N3Util.createLiteral(proteinTransVal));
					writer.addTriple(proteinTrans, 'rdfs:seeAlso', (uniProtTransPrefix + proteinTransVal));
					writer.addTriple(transAccession, 'rdf:type', 'edam:data_1093'); // edam:data_1093 == Sequence accession
					writer.addTriple(transAccession, 'rdf:label', N3Util.createLiteral(transAccessionVal));
					writer.addTriple(transAccession, 'dcterms:identifiers',
						N3Util.createLiteral(transAccessionVal));
					writer.addTriple(transAccession, 'rdfs:seeAlso', (idOrgTransPrefix + transAccessionVal));
					writer.addTriple(transAnnotation, 'rdf:type', 'rsa:SequenceAnnotation');
					writer.addTriple(transAnnotation, 'rsa:mapsTo', transRegion);
					writer.addTriple(transRegion, 'rdf:type',	'rsa:Region');
					writer.addTriple(transRegion, 'rsa:start',
						N3Util.createLiteral(hash['transcript' + count + "Start"]));
					writer.addTriple(transRegion, 'rsa:end',
						N3Util.createLiteral(hash['transcript' + count + "End"]));
				}
				writer.end(function (error, result) { getTranscriptsAndInfoResult = result; })
			}
        }

        /* send the result */
        res.status(OK).set('content-type', mimeType).send(getTranscriptsAndInfoResult);
    }

	// <-- insert implementations for other API calls here

};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// the server                                                                                                         //
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export default async (distDir, {soapUrl, consoleLogging}) => {

	/* the express application */
	let server = express();

	/* setting up the soap client */
	let soap = await Soap.createClient(soapUrl);

	/* load the middleware */
	let [middleware, swagger] = await swaggerMiddleware(`${distDir}/swagger.json`, server);

	/* serve swagger-ui based documentation */
	server.use(favicon('dist/' + require('file!./images/favicon.ico')));
	server.use('/docs', express.static(`${distDir}/docs/`));

	/* use Swagger middleware */
	server.use(
		middleware.files({apiPath: false, rawFilesPath: '/'}),
		middleware.metadata(),
		middleware.parseRequest(),
		middleware.validateRequest()
	);

	/* request handling */
	for (let path of Object.keys(swagger.paths)) {
		let pathObj = swagger.paths[path];
		let expressStylePath = path.replace(/{(\w+)}/g, ':$1');
		for (let method of Object.keys(pathObj).filter(p => !/x-/.test(p))) {
			server[method](expressStylePath, (req, res, next) => {
				let mimeType = req.accepts(swagger.produces);
				try {
					operations[pathObj[method]['x-operation']]({soap, mimeType, req, res}).catch(next);
				} catch (err) {
					next(err);
				}
			});
		}
	}

	/* handling error messages */
	server.use(errorNormalizer);
	if (consoleLogging !== false) {
		server.use(errorLogger)
	}
	server.use(errorTransmitter);
	server.use(doneWithError);

	/* return the server app */
	return server;

};
