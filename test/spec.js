const test = require('ava');
const shortid = require('shortid');
const uuid = require('uuid/v4');
const {
    validateEventRepository,
    InvalidEventError,
} = require('hebo-validation');
const EventRepositoryDynamodb = require('..');
const initDb = require('./helpers/mock-dynamodb');

const makeRepo = async () => {
    const { client: dynamodbClient } = await initDb();
    return new EventRepositoryDynamodb({
        dynamodbClient,
        aggregates: {
            book: {
                tableName: 'bookEvent',
                aggregateIdField: 'bookId',
            },
        },
    });
};

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
    t.is(error, null, 'no error generaged by validation');
});

test('writeEvent() - valid event is written', async t => {
    const repo = await makeRepo();
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 2 });

    const result1 = await repo.writeEvent(event1);
    t.true(result1, 'writeEvent() returns true with valid event');

    const result2 = await repo.writeEvent(event2);
    t.true(result2, 'writeEvent() returns true with second valid event');

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [event1, event2],
        'events written by writeEvent() succesfully stored',
    );
});

test('writeEvent() - invalid event throws an error', async t => {
    const repo = await makeRepo();
    const bookId = shortid.generate();

    // event missing type
    await t.throws(
        repo.writeEvent({
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
        await repo.getEvents('book', bookId),
        [],
        'invalid event is not stored',
    );
});

test('writeEvent() - stale sequenceNumber returns false', async t => {
    const repo = await makeRepo();
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 1 });

    await repo.writeEvent(event1);

    const result2 = await repo.writeEvent(event2);
    t.false(
        result2,
        'writeEvent() returns false for event with stale sequenceNumber',
    );

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [event1],
        'event with stale sequenceNumber not stored',
    );
});

test('getEvents() - no minimum sequenceNumber', async t => {
    const repo = await makeRepo();
    const bookId = shortid.generate();

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [],
        'getEvents() can be called on empty store',
    );

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 2 });
    const event3 = makeSetPublisherEvent({ bookId, sequenceNumber: 3 });

    await repo.writeEvent(event1);
    await repo.writeEvent(event2);
    await repo.writeEvent(event3);

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [event1, event2, event3],
        'getEvents() with no minimum sequenceNumber returns all events',
    );
});

test('getEvents() - minimum sequenceNumber', async t => {
    const repo = await makeRepo();
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ bookId, sequenceNumber: 1 });
    const event2 = makeSetTitleEvent({ bookId, sequenceNumber: 2 });
    const event3 = makeSetPublisherEvent({ bookId, sequenceNumber: 3 });

    await repo.writeEvent(event1);
    await repo.writeEvent(event2);
    await repo.writeEvent(event3);

    t.deepEqual(
        await repo.getEvents('book', bookId, 2),
        [event3],
        'getEvents() respects minimum sequenceNumber',
    );

    t.deepEqual(
        await repo.getEvents('book', bookId, 4),
        [],
        'getEvents() respects minimum sequenceNumber larger than last event',
    );
});
