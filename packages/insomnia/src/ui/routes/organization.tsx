import React, { Fragment, useEffect, useState } from 'react';
import {
  Button,
  Item,
  Link,
  Menu,
  MenuTrigger,
  Popover,
  Tooltip,
  TooltipTrigger,
} from 'react-aria-components';
import {
  LoaderFunction,
  NavLink,
  Outlet,
  redirect,
  ShouldRevalidateFunction,
  useFetcher,
  useLoaderData,
  useParams,
  useRouteLoaderData,
} from 'react-router-dom';

import {
  getAccountId,
  getCurrentSessionId,
} from '../../account/session';
import * as models from '../../models';
import { isOwnerOfOrganization, isPersonalOrganization, Organization } from '../../models/organization';
import { isDesign, isScratchpad } from '../../models/workspace';
import FileSystemDriver from '../../sync/store/drivers/file-system-driver';
import { MergeConflict } from '../../sync/types';
import { getVCS, initVCS } from '../../sync/vcs/vcs';
import { getLoginUrl } from '../auth-session-provider';
import { Avatar } from '../components/avatar';
import { GitHubStarsButton } from '../components/github-stars-button';
import { Hotkey } from '../components/hotkey';
import { Icon } from '../components/icon';
import { InsomniaAILogo } from '../components/insomnia-icon';
import { showModal } from '../components/modals';
import { showSettingsModal } from '../components/modals/settings-modal';
import { SyncMergeModal } from '../components/modals/sync-merge-modal';
import { OrganizationAvatar } from '../components/organization-avatar';
import { PresentUsers } from '../components/present-users';
import { Toast } from '../components/toast';
import { PresenceProvider } from '../context/app/presence-context';
import { NunjucksEnabledProvider } from '../context/nunjucks/nunjucks-enabled-context';
import { useRootLoaderData } from './root';
import { WorkspaceLoaderData } from './workspace';

interface OrganizationsResponse {
  start: number;
  limit: number;
  length: number;
  total: number;
  next: string;
  organizations: Organization[];
}

interface UserProfileResponse {
  id: string;
  email: string;
  name: string;
  picture: string;
  bio: string;
  github: string;
  linkedin: string;
  twitter: string;
  identities: any;
  given_name: string;
  family_name: string;
}

export const indexLoader: LoaderFunction = async () => {
  const sessionId = getCurrentSessionId();
  if (sessionId) {
    try {
      const { organizations } =
        await window.main.insomniaFetch<OrganizationsResponse>({
          method: 'GET',
          path: '/v1/organizations',
          sessionId,
        });

      const personalOrganization = organizations.filter(isPersonalOrganization).find(organization => {
        const accountId = getAccountId();
        return accountId && isOwnerOfOrganization({
          organization,
          accountId,
        });
      });

      if (personalOrganization) {
        return redirect(`/organization/${personalOrganization.id}`);
      }
    } catch (error) {
      console.log('Failed to load Organizations', error);
      return redirect('/auth/login');
    }
  }

  return redirect('/auth/login');
};

export interface OrganizationLoaderData {
  organizations: Organization[];
  user?: UserProfileResponse;
}

export const loader: LoaderFunction = async () => {
  const sessionId = getCurrentSessionId();

  if (sessionId) {
    try {
      let vcs = getVCS();
      if (!vcs) {
        const driver = FileSystemDriver.create(
          process.env['INSOMNIA_DATA_PATH'] || window.app.getPath('userData'),
        );

        console.log('Initializing VCS');
        vcs = await initVCS(driver, async conflicts => {
          return new Promise(resolve => {
            showModal(SyncMergeModal, {
              conflicts,
              handleDone: (conflicts?: MergeConflict[]) =>
                resolve(conflicts || []),
            });
          });
        });
      }

      const { organizations } =
        await window.main.insomniaFetch<OrganizationsResponse>({
          method: 'GET',
          path: '/v1/organizations',
          sessionId,
        });

      const user = await window.main.insomniaFetch<UserProfileResponse>({
        method: 'GET',
        path: '/v1/user/profile',
        sessionId,
      });

      return {
        user,
        settings: await models.settings.getOrCreate(),
        organizations: organizations
          .sort((a, b) => a.name.localeCompare(b.name))
          .sort((a, b) => {
            if (isPersonalOrganization(a) && !isPersonalOrganization(b)) {
              return -1;
            } else if (
              !isPersonalOrganization(a) &&
              isPersonalOrganization(b)
            ) {
              return 1;
            } else {
              return 0;
            }
          })
          .sort((a, b) => {
            const accountId = getAccountId();
            if (isOwnerOfOrganization({
              organization: a,
              accountId: accountId || '',
            }) && !isOwnerOfOrganization({
              organization: b,
              accountId: accountId || '',
            })) {
              return -1;
            } else if (
              !isOwnerOfOrganization({
                organization: a,
                accountId: accountId || '',
              }) &&
              isOwnerOfOrganization({
                organization: b,
                accountId: accountId || '',
              })
            ) {
              return 1;
            } else {
              return 0;
            }
          }),
      };
    } catch (err) {
      console.log('Failed to load Teams', err);
      return {
        user: null,
        organizations: [],
      };
    }
  }

  return {
    user: null,
    organizations: [],
  };
};

export const useOrganizationLoaderData = () => {
  return useRouteLoaderData('/organization') as OrganizationLoaderData;
};

export const shouldOrganizationsRevalidate: ShouldRevalidateFunction = ({
  currentParams,
  nextParams,
}) => {
  const isSwitchingBetweenOrganizations = currentParams.organizationId !== nextParams.organizationId;

  return isSwitchingBetweenOrganizations;
};

const OrganizationRoute = () => {
  const { env, settings } = useRootLoaderData();
  const { organizations, user } =
    useLoaderData() as OrganizationLoaderData;
  const workspaceData = useRouteLoaderData(
    ':workspaceId',
  ) as WorkspaceLoaderData | null;
  const logoutFetcher = useFetcher();

  const { organizationId, projectId, workspaceId } = useParams() as {
    organizationId: string;
    projectId?: string;
    workspaceId?: string;
  };

  const [status, setStatus] = useState<'online' | 'offline'>('online');

  useEffect(() => {
    const handleOnline = () => setStatus('online');
    const handleOffline = () => setStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isScratchpadWorkspace =
    workspaceData?.activeWorkspace &&
    isScratchpad(workspaceData.activeWorkspace);

  return (
    <PresenceProvider>
      <NunjucksEnabledProvider>
        <div className="w-full h-full">
          <div className={`w-full h-full divide-x divide-solid divide-y divide-[--hl-md] ${workspaceData?.activeWorkspace && isScratchpad(workspaceData?.activeWorkspace) ? 'grid-template-app-layout-with-banner' : 'grid-template-app-layout'} grid relative bg-[--color-bg]`}>
            <header className="[grid-area:Header] grid grid-cols-3 items-center">
              <div className="flex items-center">
                <div className="flex w-[50px] py-2">
                  <InsomniaAILogo />
                </div>
                {!user ? <GitHubStarsButton /> : null}
              </div>
              <div className="flex gap-2 flex-nowrap items-center justify-center">
                {workspaceData && isDesign(workspaceData?.activeWorkspace) && (
                  <nav className="flex rounded-full justify-between content-evenly font-semibold bg-[--hl-xs] p-[--padding-xxs]">
                    {[
                      { id: 'spec', name: 'spec' },
                      { name: 'collection', id: 'debug' },
                      { id: 'test', name: 'tests' },
                    ].map(item => (
                      <NavLink
                        key={item.id}
                        to={`/organization/${organizationId}/project/${projectId}/workspace/${workspaceId}/${item.id}`}
                        className={({ isActive }) =>
                          `${isActive
                            ? 'text-[--color-font] bg-[--color-bg]'
                            : ''
                          } no-underline transition-colors text-center outline-none min-w-[4rem] uppercase text-[--color-font] text-xs px-[--padding-xs] py-[--padding-xxs] rounded-full`
                        }
                      >
                        {item.name}
                      </NavLink>
                    ))}
                  </nav>
                )}
              </div>
              <div className="flex gap-[--padding-sm] items-center justify-end p-2">
                {user ? (
                  <Fragment>
                    <PresentUsers />
                    <MenuTrigger>
                      <Button className="px-1 py-1 flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-full text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm">
                        <Avatar
                          src={user.picture}
                          alt={user.name}
                        />
                        <span className="pr-2">
                          {user.name}
                        </span>
                      </Button>
                      <Popover className="min-w-max">
                        <Menu
                          onAction={action => {
                            if (action === 'logout') {
                              logoutFetcher.submit(
                                {},
                                {
                                  action: '/auth/logout',
                                  method: 'POST',
                                },
                              );
                            }

                            if (action === 'account-settings') {
                              window.main.openInBrowser(
                                `${env.websiteURL}/app/settings/account`,
                              );
                            }
                          }}
                          className="border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                        >
                          <Item
                            id="account-settings"
                            className="flex gap-2 px-[--padding-md] aria-selected:font-bold items-center text-[--color-font] h-[--line-height-xs] w-full text-md whitespace-nowrap bg-transparent hover:bg-[--hl-sm] disabled:cursor-not-allowed focus:bg-[--hl-xs] focus:outline-none transition-colors"
                            aria-label="Account settings"
                          >
                            <Icon icon="gear" />
                            <span>Account Settings</span>
                          </Item>
                          <Item
                            id="logout"
                            className="flex gap-2 px-[--padding-md] aria-selected:font-bold items-center text-[--color-font] h-[--line-height-xs] w-full text-md whitespace-nowrap bg-transparent hover:bg-[--hl-sm] disabled:cursor-not-allowed focus:bg-[--hl-xs] focus:outline-none transition-colors"
                            aria-label="logout"
                          >
                            <Icon icon="sign-out" />
                            <span>Logout</span>
                          </Item>
                        </Menu>
                      </Popover>
                    </MenuTrigger>
                  </Fragment>
                ) : (
                  <Fragment>
                    <NavLink
                      to="/auth/login"
                      className="px-4 py-1 font-semibold border border-solid border-[--hl-md] flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] rounded-sm text-[--color-font] hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
                    >
                      Login
                    </NavLink>
                    <NavLink
                      className="px-4 py-1 flex items-center justify-center gap-2 aria-pressed:bg-[rgba(var(--color-surprise-rgb),0.8)] focus:bg-[rgba(var(--color-surprise-rgb),0.9)] bg-[--color-surprise] font-semibold rounded-sm text-[--color-font-surprise] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all text-sm"
                      to="/auth/login"
                    >
                      Sign Up
                    </NavLink>
                  </Fragment>
                )}
              </div>
            </header>
            {isScratchpadWorkspace ? (
              <div className="flex h-[30px] items-center [grid-area:Banner] text-white bg-gradient-to-r from-[#7400e1] to-[#4000bf]">
                <div className="flex flex-shrink-0 basis-[50px] h-full">
                  <div className="border-solid border-r-[--hl-xl] border-r border-l border-l-[--hl-xl] box-border flex items-center justify-center w-full h-full">
                    <Icon icon="edit" />
                  </div>
                </div>
                <div className="py-[--padding-xs] overflow-hidden px-[--padding-md] w-full h-full flex items-center text-xs">
                  <p className='w-full truncate leading-normal'>
                    Welcome to the local Scratch Pad. To get the most out of
                    Insomnia and see your projects{' '}
                    <NavLink
                      to="/auth/login"
                      className="font-bold text-white inline-flex"
                    >
                      login or create an account →
                    </NavLink>
                  </p>
                </div>
              </div>
            ) : null}
            <div className="[grid-area:Navbar]">
              <nav className="flex flex-col items-center place-content-stretch gap-[--padding-md] w-full h-full overflow-y-auto py-[--padding-md]">
                {organizations.map(organization => (
                  <TooltipTrigger key={organization.id}>
                    <Link>
                      <NavLink
                        className={({ isActive }) =>
                          `select-none text-[--color-font-surprise] hover:no-underline transition-all duration-150 bg-gradient-to-br box-border from-[#4000BF] to-[#154B62] font-bold outline-[3px] rounded-md w-[28px] h-[28px] flex items-center justify-center active:outline overflow-hidden outline-offset-[3px] outline ${isActive
                            ? 'outline-[--color-font]'
                            : 'outline-transparent focus:outline-[--hl-md] hover:outline-[--hl-md]'
                          }`
                        }
                        to={`/organization/${organization.id}`}
                      >
                        {isPersonalOrganization(organization) && isOwnerOfOrganization({
                          organization,
                          accountId: getAccountId() || '',
                        }) ? (
                          <Icon icon="home" />
                        ) : (
                          <OrganizationAvatar
                            alt={organization.display_name}
                            src={organization.branding.logo_url}
                          />
                        )}
                      </NavLink>
                    </Link>
                    <Tooltip
                      placement="right"
                      offset={8}
                      className="border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                    >
                      <span>{organization.display_name}</span>
                    </Tooltip>
                  </TooltipTrigger>
                ))}
                <MenuTrigger>
                  <Button className="select-none text-[--color-font] hover:no-underline transition-all duration-150 box-border p-[--padding-sm] font-bold outline-none rounded-md w-[28px] h-[28px] flex items-center justify-center overflow-hidden">
                    <Icon icon="plus" />
                  </Button>
                  <Popover placement="left" className="min-w-max">
                    <Menu
                      onAction={action => {
                        if (action === 'join-organization') {
                          window.main.openInBrowser(
                            getLoginUrl(env.websiteURL),
                          );
                        }

                        if (action === 'new-organization') {
                          window.main.openInBrowser(
                            `${env.websiteURL}/app/organization/create`,
                          );
                        }
                      }}
                      className="border select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                    >
                      <Item
                        id="join-organization"
                        className="flex gap-2 px-[--padding-md] aria-selected:font-bold items-center text-[--color-font] h-[--line-height-xs] w-full text-md whitespace-nowrap bg-transparent hover:bg-[--hl-sm] disabled:cursor-not-allowed focus:bg-[--hl-xs] focus:outline-none transition-colors"
                        aria-label="Join an organization"
                      >
                        <Icon icon="city" />
                        <span>Join an organization</span>
                      </Item>
                      <Item
                        id="new-organization"
                        className="flex gap-2 px-[--padding-md] aria-selected:font-bold items-center text-[--color-font] h-[--line-height-xs] w-full text-md whitespace-nowrap bg-transparent hover:bg-[--hl-sm] disabled:cursor-not-allowed focus:bg-[--hl-xs] focus:outline-none transition-colors"
                        aria-label="Create new organization"
                      >
                        <Icon icon="sign-out" />
                        <span>Create a new organization</span>
                      </Item>
                    </Menu>
                  </Popover>
                </MenuTrigger>
              </nav>
            </div>
            <Outlet />
            <div className="relative [grid-area:Statusbar] flex items-center justify-between overflow-hidden">
              <div className="flex h-full">
                <TooltipTrigger>
                  <Button
                    className="px-4 py-1 h-full flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] text-[--color-font] text-xs hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all"
                    onPress={showSettingsModal}
                  >
                    <Icon icon="gear" /> Preferences
                  </Button>
                  <Tooltip
                    placement="top"
                    offset={8}
                    className="border flex items-center gap-2 select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                  >
                    Preferences
                    <Hotkey
                      keyBindings={
                        settings.hotKeyRegistry.preferences_showGeneral
                      }
                    />
                  </Tooltip>
                </TooltipTrigger>
                <TooltipTrigger>
                  <Button className="px-4 py-1 h-full flex items-center justify-center gap-2 aria-pressed:bg-[--hl-sm] text-[--color-font] text-xs hover:bg-[--hl-xs] focus:ring-inset ring-1 ring-transparent focus:ring-[--hl-md] transition-all">
                    <Icon
                      icon="circle"
                      className={
                        user
                          ? status === 'online'
                            ? 'text-[--color-success]'
                            : 'text-[--color-danger]'
                          : ''
                      }
                    />{' '}
                    {user
                      ? status.charAt(0).toUpperCase() + status.slice(1)
                      : 'Log in to sync your data'}
                  </Button>
                  <Tooltip
                    placement="top"
                    offset={8}
                    className="border flex items-center gap-2 select-none text-sm min-w-max border-solid border-[--hl-sm] shadow-lg bg-[--color-bg] text-[--color-font] px-4 py-2 rounded-md overflow-y-auto max-h-[85vh] focus:outline-none"
                  >
                    {user
                      ? `You are ${status === 'online'
                        ? 'securely connected to Insomnia Cloud'
                        : 'offline. Connect to sync your data.'
                      }`
                      : 'Log in to Insomnia to sync your data.'}
                  </Tooltip>
                </TooltipTrigger>
              </div>
              <Link>
                <a
                  className="flex focus:outline-none focus:underline gap-1 items-center text-xs text-[--color-font] px-[--padding-md]"
                  href="https://konghq.com/"
                >
                  Made with
                  <Icon className="text-[--color-surprise]" icon="heart" /> by
                  Kong
                </a>
              </Link>
            </div>
          </div>
          <Toast />
        </div>
      </NunjucksEnabledProvider>
    </PresenceProvider>
  );
};

export default OrganizationRoute;