import { Global, Module } from '@nestjs/common'
import { AccountSnapshotStore } from './account-snapshot.store'

@Global()
@Module({
	providers: [AccountSnapshotStore],
	exports: [AccountSnapshotStore],
})
export class SessionStateModule {}
