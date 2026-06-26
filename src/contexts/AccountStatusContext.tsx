'use client'
import { createContext, useContext } from 'react'

interface AccountStatusContextValue {
  isPending: boolean
}

const AccountStatusContext = createContext<AccountStatusContextValue>({ isPending: false })

export function AccountStatusProvider({
  isPending,
  children,
}: {
  isPending: boolean
  children: React.ReactNode
}) {
  return (
    <AccountStatusContext.Provider value={{ isPending }}>
      {children}
    </AccountStatusContext.Provider>
  )
}

export function useAccountStatus() {
  return useContext(AccountStatusContext)
}
