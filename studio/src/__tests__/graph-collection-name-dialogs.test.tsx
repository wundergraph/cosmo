import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  createGraphCollection,
  renameGraphCollection,
  shareGraphCollection,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import { create } from '@bufbuild/protobuf';
import { GraphCollection, GraphCollectionSchema } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CreateCollectionDialog } from '@/components/playground/graph-collections/dialogs/create-collection-dialog';
import { RenameCollectionDialog } from '@/components/playground/graph-collections/dialogs/rename-collection-dialog';
import { ShareCollectionDialog } from '@/components/playground/graph-collections/dialogs/share-collection-dialog';

type Handlers = { onSuccess: (data: { response?: { code: EnumStatusCode; details?: string } }) => void };
type Mutation = { mutate: ReturnType<typeof vi.fn>; isPending: boolean };

// One mutation per RPC, so a test can answer the rename and the share separately.
const { mutations, mutation } = vi.hoisted(() => {
  const mutations = new Map<unknown, Mutation>();
  const mutation = (method: unknown) => {
    if (!mutations.has(method)) {
      mutations.set(method, { mutate: vi.fn(), isPending: false });
    }
    return mutations.get(method)!;
  };
  return { mutations, mutation };
});

vi.mock('@connectrpc/connect-query', () => ({ useMutation: mutation }));

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/use-toast', () => ({ toast }));

/** Answers the latest call of `method` as the server would. */
const respond = (method: unknown, code: EnumStatusCode, details?: string) => {
  const { mutate } = mutation(method);
  const handlers = mutate.mock.calls.at(-1)![1] as Handlers;
  act(() => handlers.onSuccess({ response: { code, details } }));
};

const collection = (id: string, name: string, isTeamScoped: boolean) =>
  create(GraphCollectionSchema, { id, name, isTeamScoped });

const team = collection('team-1', 'Onboarding', true);
const otherTeam = collection('team-2', 'Checkout', true);
const privateScratch = collection('private-1', 'Scratch', false);

const errorText = (id: string) => document.getElementById(id)?.textContent;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// Radix's radio group measures itself, and jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  mutations.clear();
  toast.mockClear();
});

afterEach(() => cleanup());

describe('Share dialog', () => {
  const renderShare = (target: GraphCollection, collections: GraphCollection[]) => {
    const onDone = vi.fn();
    const onRenamed = vi.fn();
    render(
      <ShareCollectionDialog
        collection={target}
        collections={collections}
        federatedGraphId="graph-1"
        onClose={vi.fn()}
        onRenamed={onRenamed}
        onDone={onDone}
      />,
    );
    return { onDone, onRenamed };
  };

  test('shares straight away when no team collection has the name', () => {
    const { onDone } = renderShare(privateScratch, [team, privateScratch]);

    expect(screen.queryByLabelText('Name')).toBeNull();
    fireEvent.click(button('Share with team'));

    expect(mutation(shareGraphCollection).mutate.mock.calls[0][0]).toEqual({
      id: 'private-1',
      federatedGraphId: 'graph-1',
    });
    expect(mutation(renameGraphCollection).mutate).not.toHaveBeenCalled();

    respond(shareGraphCollection, EnumStatusCode.OK);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('a private collection with the same name does not count as a clash', () => {
    const otherPrivate = collection('private-2', 'scratch', false);
    renderShare(privateScratch, [privateScratch, otherPrivate]);

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(button('Share with team').disabled).toBe(false);
  });

  test('asks for a new name when a team collection has the name, ignoring case', () => {
    const privateOnboarding = collection('private-2', 'onboarding', false);
    renderShare(privateOnboarding, [team, privateOnboarding]);

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('onboarding');
    expect(errorText('graph-collection-share-name-error')).toBe('A team collection named "onboarding" already exists.');
    expect(button('Rename and share').disabled).toBe(true);
  });

  test('flags a new name that another team collection already uses', () => {
    const privateOnboarding = collection('private-2', 'Onboarding', false);
    renderShare(privateOnboarding, [team, otherTeam, privateOnboarding]);

    type('Name', ' CHECKOUT ');

    expect(errorText('graph-collection-share-name-error')).toBe('A team collection named "CHECKOUT" already exists.');
    expect(button('Rename and share').disabled).toBe(true);
  });

  test('renames, then shares, once the new name is free', () => {
    const privateOnboarding = collection('private-2', 'Onboarding', false);
    const { onDone } = renderShare(privateOnboarding, [team, privateOnboarding]);

    type('Name', '  Onboarding v2  ');
    expect(errorText('graph-collection-share-name-error')).toBeUndefined();
    fireEvent.click(button('Rename and share'));

    expect(mutation(renameGraphCollection).mutate.mock.calls[0][0]).toEqual({
      id: 'private-2',
      name: 'Onboarding v2',
      federatedGraphId: 'graph-1',
    });
    expect(mutation(shareGraphCollection).mutate).not.toHaveBeenCalled();

    respond(renameGraphCollection, EnumStatusCode.OK);
    expect(mutation(shareGraphCollection).mutate.mock.calls[0][0]).toEqual({
      id: 'private-2',
      federatedGraphId: 'graph-1',
    });
    expect(onDone).not.toHaveBeenCalled();

    respond(shareGraphCollection, EnumStatusCode.OK);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('does not share when the rename fails', () => {
    const privateOnboarding = collection('private-2', 'Onboarding', false);
    const { onDone, onRenamed } = renderShare(privateOnboarding, [team, privateOnboarding]);

    type('Name', 'Onboarding v2');
    fireEvent.click(button('Rename and share'));
    respond(renameGraphCollection, EnumStatusCode.ERR, 'Something broke');

    expect(mutation(shareGraphCollection).mutate).not.toHaveBeenCalled();
    expect(onRenamed).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ description: 'Something broke', duration: 3000 });
    expect(onDone).not.toHaveBeenCalled();
  });

  test('switches to asking for a new name when the list was stale and the server refuses the share', () => {
    // The list does not know that someone has since shared a "Scratch".
    const { onDone } = renderShare(privateScratch, [privateScratch]);

    fireEvent.click(button('Share with team'));
    respond(shareGraphCollection, EnumStatusCode.ERR_ALREADY_EXISTS, 'server details');

    expect(onDone).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Scratch');
    expect(errorText('graph-collection-share-name-error')).toBe('A team collection named "Scratch" already exists.');
    expect(button('Rename and share').disabled).toBe(true);

    // Typing clears the server's refusal, and the new name goes through a rename first.
    type('Name', 'Scratch 2');
    expect(errorText('graph-collection-share-name-error')).toBeUndefined();
    fireEvent.click(button('Rename and share'));
    expect(mutation(renameGraphCollection).mutate.mock.calls[0][0]).toEqual({
      id: 'private-1',
      name: 'Scratch 2',
      federatedGraphId: 'graph-1',
    });
  });

  test('reports the new name when the share is refused after the rename', () => {
    const privateOnboarding = collection('private-2', 'Onboarding', false);
    renderShare(privateOnboarding, [team, privateOnboarding]);

    type('Name', 'Onboarding v2');
    fireEvent.click(button('Rename and share'));
    respond(renameGraphCollection, EnumStatusCode.OK);
    respond(shareGraphCollection, EnumStatusCode.ERR_ALREADY_EXISTS);

    expect(errorText('graph-collection-share-name-error')).toBe(
      'A team collection named "Onboarding v2" already exists.',
    );
  });

  test('refreshes the list as soon as the rename is saved, before the share fails', () => {
    const privateOnboarding = collection('private-2', 'Onboarding', false);
    const { onDone, onRenamed } = renderShare(privateOnboarding, [team, privateOnboarding]);

    type('Name', 'Onboarding v2');
    fireEvent.click(button('Rename and share'));
    respond(renameGraphCollection, EnumStatusCode.OK);
    expect(onRenamed).toHaveBeenCalledTimes(1);

    respond(shareGraphCollection, EnumStatusCode.ERR, 'Something broke');
    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  test('renames again on retry when the earlier rename went through but the share failed', () => {
    // The list does not know that someone has since shared a "Scratch".
    renderShare(privateScratch, [privateScratch]);

    fireEvent.click(button('Share with team'));
    respond(shareGraphCollection, EnumStatusCode.ERR_ALREADY_EXISTS);

    type('Name', 'Scratch 2');
    fireEvent.click(button('Rename and share'));
    respond(renameGraphCollection, EnumStatusCode.OK);
    respond(shareGraphCollection, EnumStatusCode.ERR, 'Something broke');

    // The collection is now called "Scratch 2", so going back to "Scratch" is a rename.
    type('Name', 'Scratch');
    fireEvent.click(button('Rename and share'));

    expect(mutation(renameGraphCollection).mutate.mock.calls.map(([request]) => request)).toEqual([
      { id: 'private-1', name: 'Scratch 2', federatedGraphId: 'graph-1' },
      { id: 'private-1', name: 'Scratch', federatedGraphId: 'graph-1' },
    ]);
    expect(mutation(shareGraphCollection).mutate).toHaveBeenCalledTimes(2);
  });

  test('shares without renaming on retry when the name in the field is already saved', () => {
    renderShare(privateScratch, [privateScratch]);

    fireEvent.click(button('Share with team'));
    respond(shareGraphCollection, EnumStatusCode.ERR_ALREADY_EXISTS);

    type('Name', 'Scratch 2');
    fireEvent.click(button('Rename and share'));
    respond(renameGraphCollection, EnumStatusCode.OK);
    respond(shareGraphCollection, EnumStatusCode.ERR, 'Something broke');

    fireEvent.click(button('Rename and share'));

    expect(mutation(renameGraphCollection).mutate).toHaveBeenCalledTimes(1);
    expect(mutation(shareGraphCollection).mutate).toHaveBeenCalledTimes(3);
  });

  test('locks the name while saving', () => {
    mutation(shareGraphCollection).isPending = true;
    const privateOnboarding = collection('private-2', 'Onboarding', false);
    renderShare(privateOnboarding, [team, privateOnboarding]);

    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
  });

  test('reports other share failures as a toast', () => {
    const { onDone } = renderShare(privateScratch, [privateScratch]);

    fireEvent.click(button('Share with team'));
    respond(shareGraphCollection, EnumStatusCode.ERR, 'Something broke');

    expect(toast).toHaveBeenCalledWith({ description: 'Something broke', duration: 3000 });
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('Create dialog', () => {
  const renderCreate = (collections: GraphCollection[]) => {
    const onDone = vi.fn();
    render(
      <CreateCollectionDialog
        canCreateTeamCollection
        collections={collections}
        federatedGraphName="mygraph"
        namespace="default"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    return { onDone };
  };

  const chooseTeam = () => fireEvent.click(screen.getByRole('radio', { name: /^Team/ }));
  const choosePrivate = () => fireEvent.click(screen.getByRole('radio', { name: /^Private/ }));

  test('allows a private collection with a team collection’s name', () => {
    const { onDone } = renderCreate([team]);

    type('Name', 'onboarding');
    expect(errorText('graph-collection-name-error')).toBeUndefined();
    fireEvent.click(button('Create'));

    expect(mutation(createGraphCollection).mutate.mock.calls[0][0]).toEqual({
      federatedGraphName: 'mygraph',
      namespace: 'default',
      name: 'onboarding',
      teamScoped: false,
    });
    respond(createGraphCollection, EnumStatusCode.OK);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('flags a team name that is taken, ignoring case and surrounding spaces', () => {
    renderCreate([team]);

    type('Name', '  ONBOARDING ');
    chooseTeam();

    expect(errorText('graph-collection-name-error')).toBe('A team collection named "ONBOARDING" already exists.');
    expect(button('Create').disabled).toBe(true);
  });

  test('a private collection’s name does not block a team collection', () => {
    renderCreate([privateScratch]);

    type('Name', 'Scratch');
    chooseTeam();

    expect(errorText('graph-collection-name-error')).toBeUndefined();
    expect(button('Create').disabled).toBe(false);
  });

  test('switching back to private clears the clash', () => {
    renderCreate([team]);

    type('Name', 'Onboarding');
    chooseTeam();
    expect(button('Create').disabled).toBe(true);

    choosePrivate();
    expect(errorText('graph-collection-name-error')).toBeUndefined();
    expect(button('Create').disabled).toBe(false);
  });

  test('shows the server’s refusal under the field until the name changes', () => {
    const { onDone } = renderCreate([]);

    type('Name', 'Onboarding');
    chooseTeam();
    fireEvent.click(button('Create'));
    respond(
      createGraphCollection,
      EnumStatusCode.ERR_ALREADY_EXISTS,
      'A team collection named "Onboarding" already exists on this graph.',
    );

    expect(errorText('graph-collection-name-error')).toBe(
      'A team collection named "Onboarding" already exists on this graph.',
    );
    expect(toast).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(button('Create').disabled).toBe(true);

    type('Name', 'Onboarding 2');
    expect(errorText('graph-collection-name-error')).toBeUndefined();
    expect(button('Create').disabled).toBe(false);
  });

  test('changing the scope clears the server’s refusal', () => {
    renderCreate([]);

    type('Name', 'Onboarding');
    chooseTeam();
    fireEvent.click(button('Create'));
    respond(createGraphCollection, EnumStatusCode.ERR_ALREADY_EXISTS, 'taken');

    choosePrivate();
    expect(errorText('graph-collection-name-error')).toBeUndefined();
  });

  test('locks the name and scope while saving', () => {
    mutation(createGraphCollection).isPending = true;
    renderCreate([]);

    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLButtonElement).disabled)).toEqual([true, true]);
  });
});

describe('Rename dialog', () => {
  const renderRename = (target: GraphCollection, collections: GraphCollection[]) => {
    const onDone = vi.fn();
    render(
      <RenameCollectionDialog
        collection={target}
        collections={collections}
        federatedGraphId="graph-1"
        onClose={vi.fn()}
        onDone={onDone}
      />,
    );
    return { onDone };
  };

  test('flags renaming a team collection to another team collection’s name', () => {
    renderRename(otherTeam, [team, otherTeam]);

    type('Name', 'onboarding');

    expect(errorText('graph-collection-name-error')).toBe('A team collection named "onboarding" already exists.');
    expect(button('Rename').disabled).toBe(true);
  });

  test('a team collection can change the casing of its own name', () => {
    const { onDone } = renderRename(team, [team, otherTeam]);

    type('Name', 'ONBOARDING');
    expect(errorText('graph-collection-name-error')).toBeUndefined();
    fireEvent.click(button('Rename'));

    expect(mutation(renameGraphCollection).mutate.mock.calls[0][0]).toEqual({
      id: 'team-1',
      name: 'ONBOARDING',
      federatedGraphId: 'graph-1',
    });
    respond(renameGraphCollection, EnumStatusCode.OK);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('a private collection can take a team collection’s name', () => {
    renderRename(privateScratch, [team, privateScratch]);

    type('Name', 'Onboarding');

    expect(errorText('graph-collection-name-error')).toBeUndefined();
    expect(button('Rename').disabled).toBe(false);
  });

  test('shows the server’s refusal under the field until the name changes', () => {
    const { onDone } = renderRename(otherTeam, [otherTeam]);

    type('Name', 'Onboarding');
    fireEvent.click(button('Rename'));
    respond(
      renameGraphCollection,
      EnumStatusCode.ERR_ALREADY_EXISTS,
      'A team collection named "Onboarding" already exists on this graph.',
    );

    expect(errorText('graph-collection-name-error')).toBe(
      'A team collection named "Onboarding" already exists on this graph.',
    );
    expect(toast).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(button('Rename').disabled).toBe(true);

    type('Name', 'Onboarding 2');
    expect(errorText('graph-collection-name-error')).toBeUndefined();
  });

  test('locks the name while saving', () => {
    mutation(renameGraphCollection).isPending = true;
    renderRename(team, [team]);

    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
  });
});
