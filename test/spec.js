/*

To run this test against a live database, do the following:

# Setup Dynamodb Table:
aws dynamodb create-table \
    --table-name hebotest_book_event \
    --attribute-definitions '[
        { "AttributeName": "bookId", "AttributeType": "S" },
        { "AttributeName": "sequenceNumber", "AttributeType": "N" }
    ]' \
    --key-schema '[
        { "AttributeName": "bookId", "KeyType": "HASH" },
        { "AttributeName": "sequenceNumber", "KeyType": "RANGE" }
    ]' \
    --billing-mode PAY_PER_REQUEST
aws dynamodb wait table-exists --table-name hebotest_book_event

# Run Test:
HEBO_LIVE_DYNAMODB_TEST=1 HEBO_TEST_TABLE=hebotest_book_event \
  npx ava test/spec.js

# Cleanup Dynamodb Table:
aws dynamodb delete-table --table-name hebotest_book_event
aws dynamodb wait table-not-exists --table-name hebotest_book_event

*/

const test = require('ava');
const AWS = require('aws-sdk');
const shortid = require('shortid');
const uuid = require('uuid/v4');
const { map, omit } = require('lodash/fp');
const {
    validateEventRepository,
    InvalidEventError,
} = require('hebo-validation');
const EventRepositoryDynamodb = require('..');
const initDb = require('./helpers/mock-dynamodb');

const getLiveDynamodbClient = () => new AWS.DynamoDB();

const getMockDynamodbClient = async () => {
    const { client } = await initDb();
    return client;
};

const getDynamodbClient = process.env.HEBO_LIVE_DYNAMODB_TEST
    ? getLiveDynamodbClient
    : getMockDynamodbClient;

const getTableName = () =>
    process.env.HEBO_LIVE_DYNAMODB_TEST
        ? process.env.HEBO_TEST_TABLE
        : 'bookEvent';

const makeRepo = async () => {
    const dynamodbClient = await getDynamodbClient();
    return new EventRepositoryDynamodb({
        dynamodbClient,
        aggregates: {
            book: {
                tableName: getTableName(),
                aggregateIdField: 'bookId',
            },
        },
    });
};

const removeTimestamps = map(omit('eventTimestamp'));

const makeSetAuthorEvent = ({ bookId, sequenceNumber }) => ({
    aggregateName: 'book',
    aggregateId: bookId,
    eventId: uuid(),
    type: 'AUTHOR_SET',
    metadata: { userId: 1234 },
    payload: { author: 'Fitzgerald' },
    sequenceNumber,
});

const makeSetTitleEvent = ({ bookId, sequenceNumber }) => ({
    aggregateName: 'book',
    aggregateId: bookId,
    eventId: uuid(),
    type: 'TITLE_SET',
    metadata: { userId: 1234 },
    payload: { title: 'The Great Gatsby' },
    sequenceNumber,
});

const makeSetPublisherEvent = ({ bookId, sequenceNumber }) => ({
    aggregateName: 'book',
    aggregateId: bookId,
    eventId: uuid(),
    type: 'PUBLISHER_SET',
    metadata: { userId: 1234 },
    payload: { publisherId: shortid.generate() },
    sequenceNumber,
});

test('passes validator', async t => {
    const repo = await makeRepo();
    const { error } = validateEventRepository(repo);
    t.is(error, undefined, 'no error generaged by validation');
});

test('writeEvent() - valid event is written', async t => {
    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 2 });

    const result1 = await writeEvent(event1);
    t.true(result1, 'writeEvent() returns true with valid event');

    const result2 = await writeEvent(event2);
    t.true(result2, 'writeEvent() returns true with second valid event');

    const writtenEvents = await getEvents('book', bookId);

    t.deepEqual(
        removeTimestamps(writtenEvents),
        [event1, event2],
        'events written by writeEvent() succesfully stored',
    );
});

test('writeEvent() - invalid event throws an error', async t => {
    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    // event missing type
    await t.throws(
        writeEvent({
            aggregateName: 'book',
            aggregateId: bookId,
            eventId: uuid(),
            metadata: {},
            payload: {},
            sequenceNumber: 1,
        }),
        InvalidEventError,
        'an invalid event throws an InvalidEventError',
    );

    t.deepEqual(
        await getEvents('book', bookId),
        [],
        'invalid event is not stored',
    );
});

test('writeEvent() - stale sequenceNumber returns false', async t => {
    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 1 });

    await writeEvent(event1);

    const result2 = await writeEvent(event2);
    t.false(
        result2,
        'writeEvent() returns false for event with stale sequenceNumber',
    );

    const writtenEvents = await getEvents('book', bookId);

    t.deepEqual(
        removeTimestamps(writtenEvents),
        [event1],
        'event with stale sequenceNumber not stored',
    );
});

test('getEvents() - no minimum sequenceNumber', async t => {
    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    t.deepEqual(
        await getEvents('book', bookId),
        [],
        'getEvents() can be called on empty store',
    );

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 2 });
    const event3 = makeSetPublisherEvent({ bookId, sequenceNumber: 3 });

    await writeEvent(event1);
    await writeEvent(event2);
    await writeEvent(event3);

    const writtenEvents = await getEvents('book', bookId);

    t.deepEqual(
        removeTimestamps(writtenEvents),
        [event1, event2, event3],
        'getEvents() with no minimum sequenceNumber returns all events',
    );
});

test('getEvents() - minimum sequenceNumber', async t => {
    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 2 });
    const event3 = makeSetPublisherEvent({ bookId, sequenceNumber: 3 });

    await writeEvent(event1);
    await writeEvent(event2);
    await writeEvent(event3);

    const writtenEventsGreaterThan2 = await getEvents('book', bookId, 2);
    t.deepEqual(
        removeTimestamps(writtenEventsGreaterThan2),
        [event3],
        'getEvents() respects minimum sequenceNumber',
    );

    const writtenEventsGreaterThan4 = await getEvents('book', bookId, 4);
    t.deepEqual(
        writtenEventsGreaterThan4,
        [],
        'getEvents() respects minimum sequenceNumber larger than last event',
    );
});

test('writeEvent() - metadata can be empty', async t => {
    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    const event = {
        ...makeSetAuthorEvent({ bookId, sequenceNumber: 1 }),
        metadata: {
            user: {
                username: 'foo',
                groups: {},
            },
        },
    };

    const result = await writeEvent(event);
    t.true(result, 'writeEvent() returns true with event with empty metadata');

    const writtenEvents = await getEvents('book', bookId);

    t.deepEqual(
        removeTimestamps(writtenEvents),
        [event],
        'event returned from storage with empty metadata',
    );
});

test('writeEvent() - timestamp added to event', async t => {
    const startTimestamp = Date.now();

    const repo = await makeRepo();
    const { writeEvent, getEvents } = repo;
    const bookId = shortid.generate();

    const event = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });

    const result = await writeEvent(event);
    t.true(result, 'writeEvent() returns true with valid event');

    const writtenEvents = await getEvents('book', bookId);
    t.is(writtenEvents.length, 1, 'expected number of events written');

    const writtenTimestamp = writtenEvents[0].eventTimestamp;

    t.truthy(writtenTimestamp, 'event written with eventTimestamp');
    t.true(
        writtenTimestamp >= startTimestamp &&
            writtenTimestamp <= startTimestamp + 2000,
        'event written with eventTimestamp in expected range',
    );
});
