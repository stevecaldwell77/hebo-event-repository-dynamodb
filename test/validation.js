const test = require('ava');
const { omit } = require('lodash');
const shortid = require('shortid');
const uuid = require('uuid/v4');
const AWS = require('aws-sdk');
const EventRepositoryDynamodb = require('..');
const initDb = require('./helpers/mock-dynamodb');

test('constructor validation', async t => {
    const { client: dynamodbClient } = await initDb();
    const validParams = {
        dynamodbClient,
        aggregates: {
            book: {
                tableName: 'bookEvent',
                aggregateIdField: 'bookId',
            },
            author: {
                tableName: 'authorEvent',
                aggregateIdField: 'authorId',
            },
        },
    };

    t.notThrows(
        () => new EventRepositoryDynamodb(validParams),
        'able to construct repo with valid paramse',
    );

    t.throws(
        () => new EventRepositoryDynamodb(),
        /aggregates required/,
        'must have params',
    );

    t.throws(
        () => new EventRepositoryDynamodb(omit(validParams, 'aggregates')),
        /aggregates required/,
        'aggregates required',
    );

    t.throws(
        () =>
            new EventRepositoryDynamodb({
                ...validParams,
                aggregates: 'aggregates',
            }),
        /aggregates must be a plain object/,
        'aggregates type check',
    );

    t.throws(
        () =>
            new EventRepositoryDynamodb({
                ...validParams,
                aggregates: {
                    book: 'bookEvent',
                },
            }),
        /invalid aggregate configuration for "book": must be a plain object/,
        'aggregate type check',
    );

    t.throws(
        () =>
            new EventRepositoryDynamodb({
                ...validParams,
                aggregates: {
                    book: {
                        aggregateIdField: 'bookId',
                    },
                },
            }),
        /"book": bad\/missing tableName/,
        'tableName required',
    );

    t.throws(
        () =>
            new EventRepositoryDynamodb({
                ...validParams,
                aggregates: {
                    book: {
                        tableName: [],
                        aggregateIdField: 'bookId',
                    },
                },
            }),
        /"book": bad\/missing tableName/,
        'tableName type check',
    );

    t.throws(
        () =>
            new EventRepositoryDynamodb({
                ...validParams,
                aggregates: {
                    book: {
                        tableName: 'bookEvent',
                        aggregateIdField: [],
                    },
                },
            }),
        /"book": bad\/missing aggregateIdField/,
        'aggregateIdField type check',
    );

    t.throws(
        () => new EventRepositoryDynamodb(omit(validParams, 'dynamodbClient')),
        /dynamodbClient required/,
        'dynamodbClient required',
    );

    t.throws(
        () =>
            new EventRepositoryDynamodb({
                ...validParams,
                dynamodbClient: {},
            }),
        /invalid dynamodbClient/,
        'dynamodbClient type check',
    );
});

// Test that we only trap ConditionalCheckFailedException errors when writing
// events
test('dynamodb write errors propogated', async t => {
    const { client: dynamodbClientOrig } = await initDb();
    const badPort = dynamodbClientOrig.endpoint.port + 1;
    const dynamodbClient = new AWS.DynamoDB({
        endpoint: `http://localhost:${badPort}`,
        accessKeyId: 'xxxxxxxxx',
        secretAccessKey: 'yyyyyyyyy',
        maxRetries: 0,
        httpOptions: {
            connectTimeout: 1,
            timeout: 1,
        },
    });

    const repo = new EventRepositoryDynamodb({
        dynamodbClient,
        aggregates: {
            book: {
                tableName: 'bookEvent',
                aggregateIdField: 'bookId',
            },
        },
    });

    const err = await t.throws(
        repo.writeEvent({
            aggregateName: 'book',
            aggregateId: shortid.generate(),
            eventId: uuid(),
            type: 'AUTHOR_SET',
            metadata: { userId: 1234 },
            payload: { author: 'Fitzgerald' },
            sequenceNumber: 1,
        }),
        Error,
        'Dynamodb errors are thrown',
    );
    t.regex(err.code, /NetworkingError|TimeoutError/, 'correct error thrown');
});
