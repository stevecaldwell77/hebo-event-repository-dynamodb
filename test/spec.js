const test = require('ava');
const shortid = require('shortid');
const { InvalidEventError } = require('hebo/errors');
const { validateEventRepository } = require('hebo/validators');
const EventRepositoryDynamodb = require('..');
const makeDynamodbClient = require('./helpers/dynamodb-client');

const makeRepo = () =>
    new EventRepositoryDynamodb({
        dynamodbClient: makeDynamodbClient(),
        aggregates: {
            book: {
                tableName: 'bookEvent',
                aggregateIdField: 'bookId',
            },
        },
    });

const makeSetAuthorEvent = ({ version }) => ({
    eventId: shortid.generate(),
    type: 'AUTHOR_SET',
    metadata: { userId: 1234 },
    payload: { author: 'Fitzgerald' },
    version,
});

const makeSetTitleEvent = ({ version }) => ({
    eventId: shortid.generate(),
    type: 'TITLE_SET',
    metadata: { userId: 1234 },
    payload: { title: 'The Great Gatsby' },
    version,
});

const makeSetPublisherEvent = ({ version }) => ({
    eventId: shortid.generate(),
    type: 'PUBLISHER_SET',
    metadata: { userId: 1234 },
    payload: { publisherId: shortid.generate() },
    version,
});

test('passes validator', t => {
    const repo = makeRepo();
    const { error } = validateEventRepository(repo);
    t.is(error, null, 'no error generaged by validation');
});

test('writeEvent() - valid event is written', async t => {
    const repo = makeRepo();
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ version: 1 });
    const event2 = makeSetTitleEvent({ version: 2 });

    const result1 = await repo.writeEvent('book', bookId, event1);
    t.true(result1, 'writeEvent() returns true with valid event');

    const result2 = await repo.writeEvent('book', bookId, event2);
    t.true(result2, 'writeEvent() returns true with second valid event');

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [event1, event2],
        'events written by writeEvent() succesfully stored',
    );
});

test('writeEvent() - invalid event throws an error', async t => {
    const repo = makeRepo();
    const bookId = shortid.generate();

    // event missing type
    await t.throws(
        repo.writeEvent('book', bookId, {
            eventId: shortid.generate(),
            metadata: {},
            payload: {},
            version: 1,
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

test('writeEvent() - event with stale version returns false', async t => {
    const repo = makeRepo();
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ version: 1 });
    const event2 = makeSetTitleEvent({ version: 1 });

    await repo.writeEvent('book', bookId, event1);

    const result2 = await repo.writeEvent('book', bookId, event2);
    t.false(result2, 'writeEvent() returns false for event with stale version');

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [event1],
        'event with stale version not stored',
    );
});

test('getEvents() - no minimum version', async t => {
    const repo = makeRepo();
    const bookId = shortid.generate();

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [],
        'getEvents() can be called on empty store',
    );

    const event1 = makeSetAuthorEvent({ version: 1 });
    const event2 = makeSetTitleEvent({ version: 2 });
    const event3 = makeSetPublisherEvent({ version: 3 });

    await repo.writeEvent('book', bookId, event1);
    await repo.writeEvent('book', bookId, event2);
    await repo.writeEvent('book', bookId, event3);

    t.deepEqual(
        await repo.getEvents('book', bookId),
        [event1, event2, event3],
        'getEvents() with no minimum version returns all events',
    );
});

test('getEvents() - minimum version', async t => {
    const repo = makeRepo();
    const bookId = shortid.generate();

    const event1 = makeSetAuthorEvent({ version: 1 });
    const event2 = makeSetTitleEvent({ version: 2 });
    const event3 = makeSetPublisherEvent({ version: 3 });

    await repo.writeEvent('book', bookId, event1);
    await repo.writeEvent('book', bookId, event2);
    await repo.writeEvent('book', bookId, event3);

    t.deepEqual(
        await repo.getEvents('book', bookId, 2),
        [event3],
        'getEvents() respects minimum version',
    );

    t.deepEqual(
        await repo.getEvents('book', bookId, 4),
        [],
        'getEvents() respects minimum version larger than last event',
    );
});
